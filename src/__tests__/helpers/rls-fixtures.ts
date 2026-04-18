/**
 * Fixture builder for RLS tests — creates a site + minimal related rows for a
 * given user via service-role, returning row IDs and the site_key. Tests use
 * this to seed "user B's data" and then assert user A can't read it.
 */

import { serviceRoleClient, type TestUser } from './supabase'

export interface UserFixture {
  user: TestUser
  siteId: string
  siteKey: string
  pageId: number
  embeddingId: number
  leadId: number
  conversationId: string
}

export async function seedUserFixture(
  user: TestUser,
  overrides: { url?: string } = {}
): Promise<UserFixture> {
  const admin = serviceRoleClient()
  const url = overrides.url ?? `https://${user.userId.slice(0, 8)}.test`

  const { data: site, error: siteErr } = await admin
    .from('sites')
    .insert({
      user_id: user.userId,
      url,
      crawl_status: 'ready',
      active_crawl_batch: 1,
    })
    .select('id, site_key')
    .single()
  if (siteErr || !site) throw new Error(`seed site failed: ${siteErr?.message}`)

  const { data: page, error: pageErr } = await admin
    .from('pages')
    .insert({
      site_id: site.id,
      url,
      title: 'home',
      content: 'Hello world content for RLS fixture.',
      crawl_batch: 1,
    })
    .select('id')
    .single()
  if (pageErr || !page) throw new Error(`seed page failed: ${pageErr?.message}`)

  // Embedding vector is 1536 floats; RLS tests don't care about content, so a
  // zero-vector is fine. Represent as a string literal for Postgres array input.
  const zeroVec = '[' + new Array(1536).fill(0).join(',') + ']'
  const { data: embedding, error: embedErr } = await admin
    .from('embeddings')
    .insert({
      site_id: site.id,
      page_id: page.id,
      chunk_text: 'fixture chunk',
      source_url: url,
      embedding: zeroVec,
      crawl_batch: 1,
    })
    .select('id')
    .single()
  if (embedErr || !embedding) throw new Error(`seed embedding failed: ${embedErr?.message}`)

  const { data: conversation, error: convErr } = await admin
    .from('conversations')
    .insert({
      site_id: site.id,
      visitor_id: `visitor-${user.userId.slice(0, 8)}`,
      messages: [],
    })
    .select('id')
    .single()
  if (convErr || !conversation) {
    throw new Error(`seed conversation failed: ${convErr?.message}`)
  }

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .insert({
      site_id: site.id,
      conversation_id: conversation.id,
      email: `lead-${user.userId.slice(0, 8)}@test.local`,
      name: 'fixture lead',
    })
    .select('id')
    .single()
  if (leadErr || !lead) throw new Error(`seed lead failed: ${leadErr?.message}`)

  return {
    user,
    siteId: site.id,
    siteKey: site.site_key as string,
    pageId: page.id,
    embeddingId: embedding.id,
    leadId: lead.id,
    conversationId: conversation.id,
  }
}
