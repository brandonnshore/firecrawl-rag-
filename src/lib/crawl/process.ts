import { createServiceClient } from '@/lib/supabase/service'
import { cleanMarkdown } from './clean'
import { chunkMarkdown } from './chunk'
import crypto from 'crypto'
import pLimit from 'p-limit'
import OpenAI from 'openai'

/**
 * Shape of a crawled page from Firecrawl webhook payload.
 */
export interface CrawledPage {
  markdown?: string
  metadata?: {
    title?: string
    sourceURL?: string
    statusCode?: number
  }
}

/**
 * Process crawled pages: clean, chunk, deduplicate, embed, and store.
 * Then atomically swap the active batch and clean up old data.
 */
export async function processCrawlData(
  siteId: string,
  pages: CrawledPage[]
): Promise<void> {
  const supabase = createServiceClient()

  // Get current site info to determine the new batch number
  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('active_crawl_batch')
    .eq('id', siteId)
    .single()

  if (siteError || !site) {
    throw new Error(`Failed to fetch site: ${siteError?.message ?? 'Not found'}`)
  }

  const newBatch = (site.active_crawl_batch ?? 0) + 1

  // Step 1: Process each page — clean markdown, generate chunks
  const allChunks: Array<{
    pageUrl: string
    pageTitle: string
    pageContent: string
    contentHash: string
    chunkText: string
    sourceUrl: string
  }> = []

  const seenPageHashes = new Set<string>()
  const seenChunkHashes = new Set<string>()

  let skippedNoMarkdown = 0
  let skippedCleanEmpty = 0

  for (const page of pages) {
    if (!page.markdown || !page.metadata?.sourceURL) {
      skippedNoMarkdown++
      console.log(
        `[process] Skipped page (no markdown): url=${page.metadata?.sourceURL ?? 'unknown'}, markdown length=${page.markdown?.length ?? 0}`
      )
      continue
    }

    const cleaned = cleanMarkdown(page.markdown)
    if (cleaned.length === 0) {
      skippedCleanEmpty++
      console.log(
        `[process] Skipped page (clean empty): url=${page.metadata.sourceURL}, raw=${page.markdown.length}, cleaned=0`
      )
      continue
    }

    const pageUrl = page.metadata.sourceURL
    const pageTitle = page.metadata.title ?? ''
    const contentHash = crypto
      .createHash('sha256')
      .update(cleaned)
      .digest('hex')

    // Deduplicate at page level
    if (seenPageHashes.has(contentHash)) continue
    seenPageHashes.add(contentHash)

    const chunks = chunkMarkdown(cleaned)

    for (const chunk of chunks) {
      // Deduplicate at chunk level
      const chunkHash = crypto
        .createHash('sha256')
        .update(chunk.text)
        .digest('hex')

      if (seenChunkHashes.has(chunkHash)) continue
      seenChunkHashes.add(chunkHash)

      allChunks.push({
        pageUrl,
        pageTitle,
        pageContent: cleaned,
        contentHash,
        chunkText: chunk.text,
        sourceUrl: pageUrl,
      })
    }
  }

  console.log(
    `[process] Result: ${pages.length} total pages, ${skippedNoMarkdown} no markdown, ${skippedCleanEmpty} clean empty, ${allChunks.length} chunks produced`
  )

  if (allChunks.length === 0) {
    throw new Error('No valid content found in crawled pages')
  }

  // Step 2: Insert pages (deduplicated)
  const uniquePages = new Map<string, {
    url: string
    title: string
    content: string
    contentHash: string
  }>()

  for (const chunk of allChunks) {
    if (!uniquePages.has(chunk.pageUrl)) {
      uniquePages.set(chunk.pageUrl, {
        url: chunk.pageUrl,
        title: chunk.pageTitle,
        content: chunk.pageContent,
        contentHash: chunk.contentHash,
      })
    }
  }

  const pageInserts = Array.from(uniquePages.values()).map((p) => ({
    site_id: siteId,
    url: p.url,
    title: p.title,
    content: p.content,
    content_hash: p.contentHash,
    crawl_batch: newBatch,
  }))

  const { data: insertedPages, error: pageInsertError } = await supabase
    .from('pages')
    .insert(pageInserts)
    .select('id, url')

  if (pageInsertError) {
    throw new Error(`Failed to insert pages: ${pageInsertError.message}`)
  }

  // Build URL -> page_id mapping
  const pageIdMap = new Map<string, number>()
  for (const p of insertedPages ?? []) {
    pageIdMap.set(p.url, p.id)
  }

  // Step 3: Batch embed chunks via OpenAI
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
  const limit = pLimit(3) // Max 3 concurrent embedding requests

  // Process in batches of 100
  const BATCH_SIZE = 100
  const embeddingResults: Array<{
    chunkText: string
    sourceUrl: string
    embedding: number[]
  }> = []

  const batches: Array<typeof allChunks> = []
  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    batches.push(allChunks.slice(i, i + BATCH_SIZE))
  }

  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const texts = batch.map((c) => c.chunkText)
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: texts,
        })

        for (let i = 0; i < batch.length; i++) {
          embeddingResults.push({
            chunkText: batch[i].chunkText,
            sourceUrl: batch[i].sourceUrl,
            embedding: response.data[i].embedding,
          })
        }
      })
    )
  )

  // Step 4: Store embeddings
  const embeddingInserts = embeddingResults.map((er) => {
    const pageId = pageIdMap.get(er.sourceUrl)
    if (!pageId) {
      throw new Error(`No page_id found for URL: ${er.sourceUrl}`)
    }
    return {
      site_id: siteId,
      page_id: pageId,
      chunk_text: er.chunkText,
      source_url: er.sourceUrl,
      embedding: JSON.stringify(er.embedding),
      crawl_batch: newBatch,
    }
  })

  // Insert embeddings in batches to avoid payload size limits
  const EMBED_INSERT_BATCH = 50
  for (let i = 0; i < embeddingInserts.length; i += EMBED_INSERT_BATCH) {
    const batch = embeddingInserts.slice(i, i + EMBED_INSERT_BATCH)
    const { error: embedInsertError } = await supabase
      .from('embeddings')
      .insert(batch)

    if (embedInsertError) {
      throw new Error(`Failed to insert embeddings: ${embedInsertError.message}`)
    }
  }

  // Step 5: Atomic swap — update site to new batch
  const { error: swapError } = await supabase
    .from('sites')
    .update({
      active_crawl_batch: newBatch,
      crawl_status: 'ready',
      last_crawled_at: new Date().toISOString(),
      crawl_page_count: uniquePages.size,
      crawl_error_message: null,
    })
    .eq('id', siteId)

  if (swapError) {
    throw new Error(`Failed to swap active batch: ${swapError.message}`)
  }

  // Step 6: Cleanup old batch data
  const oldBatch = newBatch - 1
  if (oldBatch >= 1) {
    // Delete old embeddings first (FK constraint)
    await supabase
      .from('embeddings')
      .delete()
      .eq('site_id', siteId)
      .lt('crawl_batch', newBatch)

    // Delete old pages
    await supabase
      .from('pages')
      .delete()
      .eq('site_id', siteId)
      .lt('crawl_batch', newBatch)
  }
}

/**
 * Mark a crawl as failed with an error message.
 */
export async function markCrawlFailed(
  siteId: string,
  errorMessage: string
): Promise<void> {
  const supabase = createServiceClient()

  await supabase
    .from('sites')
    .update({
      crawl_status: 'failed',
      crawl_error_message: errorMessage,
    })
    .eq('id', siteId)
}
