import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  MAX_FILE_BYTES,
  inferExtension,
  verifyMagicBytes,
  sanitizeTraversalFilename,
} from '@/lib/files/validate'

const STARTER_FILE_LIMIT_FALLBACK = 25

/**
 * POST /api/files — upload a knowledge file. Happy path:
 *   auth -> size cap -> extension allow-list -> magic-byte sniff ->
 *   0-byte reject -> SHA-256 hash -> plan file cap -> sanitize filename ->
 *   INSERT row (UNIQUE(site_id, content_hash) gates dedupe) -> upload to
 *   Storage at `{user_id}/{file_id}.{ext}` -> increment files_stored.
 *
 * On dedupe: returns 200 {duplicate:true, existing_id} without a new row.
 */
export async function POST(request: Request): Promise<Response> {
  // 1. Auth
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Early size-cap check via Content-Length
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_FILE_BYTES + 1024) {
    return Response.json(
      { error: 'file_too_large', max_bytes: MAX_FILE_BYTES },
      { status: 413 }
    )
  }

  // 3. Parse form data
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 })
  }
  // Duck-type File detection — instanceof is unreliable across jsdom /
  // edge / node runtimes where the File constructor identity differs.
  const fileEntry = formData.get('file') as
    | (Blob & { name?: string; size: number })
    | null
  if (
    !fileEntry ||
    typeof fileEntry !== 'object' ||
    typeof (fileEntry as Blob).arrayBuffer !== 'function' ||
    typeof fileEntry.size !== 'number'
  ) {
    return Response.json({ error: 'Missing file field' }, { status: 400 })
  }
  const originalName = fileEntry.name || 'file'

  // 4. Post-parse size cap (final authority over lying Content-Length)
  if (fileEntry.size > MAX_FILE_BYTES) {
    return Response.json(
      { error: 'file_too_large', max_bytes: MAX_FILE_BYTES },
      { status: 413 }
    )
  }
  if (fileEntry.size === 0) {
    return Response.json({ error: 'empty_file' }, { status: 400 })
  }

  // 5. Extension allow-list
  const ext = inferExtension(originalName)
  if (!ext) {
    return Response.json(
      {
        error: 'unsupported_type',
        allowed: ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'md'],
      },
      { status: 400 }
    )
  }

  // 6. Read bytes + magic-byte sniff
  const arrayBuffer = await fileEntry.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  if (!verifyMagicBytes(bytes, ext)) {
    return Response.json(
      { error: 'mime_mismatch', reason: 'magic_bytes' },
      { status: 400 }
    )
  }

  // 7. Hash
  const contentHash = crypto
    .createHash('sha256')
    .update(bytes)
    .digest('hex')

  // 8. Caller's site + plan limit
  const { data: site, error: siteErr } = await supabase
    .from('sites')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle<{ id: string }>()
  if (siteErr) {
    return Response.json({ error: 'site_lookup_failed' }, { status: 500 })
  }
  if (!site) {
    return Response.json({ error: 'no_site' }, { status: 400 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan_id')
    .eq('id', user.id)
    .maybeSingle<{ plan_id: string | null }>()

  const { data: plan } = profile?.plan_id
    ? await supabase
        .from('plans')
        .select('supplementary_file_limit')
        .eq('id', profile.plan_id)
        .maybeSingle<{ supplementary_file_limit: number }>()
    : { data: null }

  const fileLimit =
    plan?.supplementary_file_limit ?? STARTER_FILE_LIMIT_FALLBACK

  // Count existing files for the caller's site.
  const admin = createServiceClient()
  const { count: currentCount } = await admin
    .from('supplementary_files')
    .select('*', { count: 'exact', head: true })
    .eq('site_id', site.id)

  if ((currentCount ?? 0) >= fileLimit) {
    return Response.json(
      {
        error: 'file_limit_exceeded',
        used: currentCount,
        limit: fileLimit,
        upgrade_url: '/dashboard/settings/billing',
      },
      { status: 403 }
    )
  }

  // 9. Dedupe check (fast path — avoids a Storage upload on conflict)
  const { data: existing } = await admin
    .from('supplementary_files')
    .select('id')
    .eq('site_id', site.id)
    .eq('content_hash', contentHash)
    .maybeSingle<{ id: string }>()
  if (existing) {
    return Response.json(
      { duplicate: true, existing_id: existing.id },
      { status: 200 }
    )
  }

  // 10. Insert row first so we have an id for the storage path
  const fileId = crypto.randomUUID()
  // Use the traversal-aware sanitizer directly — it joins path segments
  // with '_' and then applies the regular filename rules. Calling
  // sanitizeFilename first would strip the path to its basename and
  // defeat VAL-FILE-019.
  const safeName = sanitizeTraversalFilename(originalName)
  const storagePath = `${user.id}/${fileId}.${ext}`

  const { error: insertErr } = await admin
    .from('supplementary_files')
    .insert({
      id: fileId,
      site_id: site.id,
      filename: safeName,
      storage_path: storagePath,
      bytes: fileEntry.size,
      content_hash: contentHash,
      status: 'queued',
    })
  if (insertErr) {
    if (insertErr.code === '23505') {
      // Race: someone inserted concurrently after our dedupe check. Re-fetch.
      const { data: dup } = await admin
        .from('supplementary_files')
        .select('id')
        .eq('site_id', site.id)
        .eq('content_hash', contentHash)
        .maybeSingle<{ id: string }>()
      return Response.json(
        { duplicate: true, existing_id: dup?.id },
        { status: 200 }
      )
    }
    return Response.json({ error: 'insert_failed' }, { status: 500 })
  }

  // 11. Upload to Storage
  const { error: storageErr } = await admin.storage
    .from('knowledge-files')
    .upload(storagePath, bytes, {
      contentType: fileEntry.type || 'application/octet-stream',
      upsert: false,
    })
  if (storageErr) {
    // Rollback the DB row so the UI doesn't show a phantom file.
    await admin.from('supplementary_files').delete().eq('id', fileId)
    return Response.json(
      { error: 'storage_upload_failed', details: storageErr.message },
      { status: 500 }
    )
  }

  // 12. Increment usage_counters.files_stored (cumulative across periods)
  const { data: counter } = await admin
    .from('usage_counters')
    .select('files_stored')
    .eq('user_id', user.id)
    .maybeSingle<{ files_stored: number }>()
  const current = counter?.files_stored ?? 0
  await admin
    .from('usage_counters')
    .update({ files_stored: current + 1, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)

  return Response.json({
    file_id: fileId,
    filename: safeName,
    status: 'queued',
  })
}
