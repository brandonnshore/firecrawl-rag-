import { processFile } from '@/lib/files/process'

export const maxDuration = 300 // 5 min — long parse + embed runs

/**
 * POST /api/files/process — background processor endpoint.
 * Body: { file_id: string }
 *
 * Invoked by the upload route via `after()` (preferred — zero-trust,
 * same-process) and optionally by a UI "Retry" button for failed files.
 * No body signing required because the only effect of a spurious call is
 * to re-process an existing file; it can't fabricate rows.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { file_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const fileId = body.file_id
  if (typeof fileId !== 'string' || fileId.length === 0) {
    return Response.json({ error: 'file_id required' }, { status: 400 })
  }
  await processFile(fileId)
  return Response.json({ ok: true })
}
