/**
 * Background processor for uploaded knowledge files. Entry point is
 * processFile(fileId). Downloads the Storage object, parses, chunks,
 * embeds, and inserts embeddings — all via the service-role client so
 * the widget path can later retrieve them alongside crawled chunks.
 *
 * Status transitions: queued -> processing -> ready (happy) OR
 * queued -> processing -> failed (with error_message).
 */

import OpenAI from 'openai'
import pLimit from 'p-limit'
import { createServiceClient } from '@/lib/supabase/service'
import { chunkMarkdown } from '@/lib/crawl/chunk'
import { parseFile, FileParseError } from './parsers'
import { inferExtension } from './validate'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBED_BATCH_SIZE = 100
const EMBED_CONCURRENCY = 3

interface FileRow {
  id: string
  site_id: string
  filename: string
  storage_path: string
}

export async function processFile(fileId: string): Promise<void> {
  const admin = createServiceClient()

  const { data: file, error: fetchErr } = await admin
    .from('supplementary_files')
    .select('id, site_id, filename, storage_path')
    .eq('id', fileId)
    .single<FileRow>()

  if (fetchErr || !file) {
    console.error('[files.process] file not found', { fileId, fetchErr })
    return
  }

  await admin
    .from('supplementary_files')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', fileId)

  try {
    await runPipeline(file)
  } catch (err) {
    const message =
      err instanceof FileParseError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unknown processing error'
    console.error('[files.process] failed', { fileId, message })
    await admin
      .from('supplementary_files')
      .update({
        status: 'failed',
        error_message: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileId)
  }
}

async function runPipeline(file: FileRow): Promise<void> {
  const admin = createServiceClient()

  // 1. Download from Storage
  const { data: blob, error: dlErr } = await admin.storage
    .from('knowledge-files')
    .download(file.storage_path)
  if (dlErr || !blob) {
    throw new FileParseError(
      'storage_download_failed',
      dlErr?.message ?? 'Could not read uploaded file from storage.'
    )
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())

  // 2. Parse
  const ext = inferExtension(file.filename)
  if (!ext) {
    throw new FileParseError(
      'unsupported_type',
      `Filename ${file.filename} has no supported extension.`
    )
  }
  const parsed = await parseFile(bytes, ext)
  if (!parsed.text || parsed.text.trim().length === 0) {
    throw new FileParseError(
      'empty_extracted_text',
      'File parsed successfully but contained no extractable text.'
    )
  }

  // 3. Chunk — reuse the crawl chunker. It treats the input as markdown,
  // which is fine for any extracted text (headers are just Markdown-ish).
  const chunks = chunkMarkdown(parsed.text)
  if (chunks.length === 0) {
    throw new FileParseError(
      'no_chunks',
      'File text could not be chunked into indexable segments.'
    )
  }

  // 4. Embed in batches
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })
  const limit = pLimit(EMBED_CONCURRENCY)
  const batches: (typeof chunks)[] = []
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    batches.push(chunks.slice(i, i + EMBED_BATCH_SIZE))
  }

  const embedResults: Array<{ text: string; embedding: number[] }> = []
  await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const response = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: batch.map((c) => c.text),
        })
        for (let i = 0; i < batch.length; i++) {
          embedResults.push({
            text: batch[i]!.text,
            embedding: response.data[i]!.embedding,
          })
        }
      })
    )
  )

  // 5. Store embeddings. source_type='file' + file_id FK link.
  const sourceUrl = `file://${file.filename}`
  const inserts = embedResults.map((e) => ({
    site_id: file.site_id,
    file_id: file.id,
    chunk_text: e.text,
    source_url: sourceUrl,
    embedding: JSON.stringify(e.embedding),
    source_type: 'file',
    // File embeddings aren't part of the blue/green crawl batch system —
    // they live across crawls. Pin to batch=1 so existing indexes still
    // function; retrieval filters by source_type.
    crawl_batch: 1,
  }))

  const EMBED_INSERT_BATCH = 50
  for (let i = 0; i < inserts.length; i += EMBED_INSERT_BATCH) {
    const slice = inserts.slice(i, i + EMBED_INSERT_BATCH)
    const { error: insErr } = await admin.from('embeddings').insert(slice)
    if (insErr) {
      throw new FileParseError(
        'embedding_insert_failed',
        insErr.message
      )
    }
  }

  // 6. Mark ready
  await admin
    .from('supplementary_files')
    .update({
      status: 'ready',
      chunks_count: chunks.length,
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', file.id)
}
