import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * DELETE /api/files/{id} — remove a knowledge file end-to-end.
 *
 * Authorization comes from two layers:
 *   (a) the auth check up front (rejects guests)
 *   (b) the user-session client's SELECT against supplementary_files —
 *       RLS scopes the row to the caller's site, so a cross-user id
 *       returns 404 without leaking row metadata.
 *
 * Cascade (via service role once ownership is verified):
 *   1. embeddings WHERE file_id = id   (FK ON DELETE CASCADE also covers this)
 *   2. storage.objects at file.storage_path
 *   3. supplementary_files row
 *   4. usage_counters.files_stored -= 1
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await context.params
  if (!id) {
    return Response.json({ error: 'missing_id' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ownership check via user-session client: RLS filters to caller's site.
  const { data: file, error: lookupErr } = await supabase
    .from('supplementary_files')
    .select('id, storage_path')
    .eq('id', id)
    .maybeSingle<{ id: string; storage_path: string }>()

  if (lookupErr) {
    return Response.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!file) {
    // Either the id is bogus or RLS hid it. Either way, 404.
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const admin = createServiceClient()

  // 1. Storage object — best-effort; a missing object still lets the
  // DB cleanup proceed (e.g., row was orphaned from a prior failure).
  const { error: storageErr } = await admin.storage
    .from('knowledge-files')
    .remove([file.storage_path])
  if (storageErr) {
    console.warn('[files.delete] storage remove warning', {
      id,
      message: storageErr.message,
    })
  }

  // 2. embeddings — FK ON DELETE CASCADE removes them when the row below
  // is deleted, but we do it explicitly here so the order is deterministic
  // and doesn't depend on trigger timing.
  await admin.from('embeddings').delete().eq('file_id', id)

  // 3. supplementary_files row
  const { error: deleteErr } = await admin
    .from('supplementary_files')
    .delete()
    .eq('id', id)
  if (deleteErr) {
    return Response.json({ error: 'delete_failed' }, { status: 500 })
  }

  // 4. usage_counters.files_stored -= 1 (never below 0)
  const { data: counter } = await admin
    .from('usage_counters')
    .select('files_stored')
    .eq('user_id', user.id)
    .maybeSingle<{ files_stored: number }>()
  const current = counter?.files_stored ?? 0
  await admin
    .from('usage_counters')
    .update({
      files_stored: Math.max(0, current - 1),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  return Response.json({ deleted: id })
}
