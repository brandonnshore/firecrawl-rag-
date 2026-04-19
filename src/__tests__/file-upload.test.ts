/**
 * M5F2 file-upload-api-limits — route-level tests with mocked Supabase.
 *
 * Fulfills VAL-FILE-010/011/012/018/019/021. Tests assert response codes
 * and insert shape; actual Storage upload + DB insert proved in integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetUser,
  mockFromServer,
  mockFromService,
  mockStorageUpload,
  mockStorageFrom,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFromServer: vi.fn(),
  mockFromService: vi.fn(),
  mockStorageUpload: vi.fn(),
  mockStorageFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFromServer,
  })),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: mockFromService,
    storage: { from: mockStorageFrom },
  })),
}))

// Stub next/server after() so the upload route's post-response hook
// doesn't try to run the real background processor during tests.
vi.mock('next/server', () => ({
  after: vi.fn(),
}))

vi.mock('@/lib/files/process', () => ({
  processFile: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/files/route'

interface SetupOpts {
  planFileLimit?: number
  existingCount?: number
  existingHashId?: string | null
  insertErrCode?: string
  insertRaceExistingId?: string | null
  siteId?: string | null
  planId?: string | null
}

function setup(opts: SetupOpts = {}) {
  const {
    planFileLimit = 25,
    existingCount = 0,
    existingHashId = null,
    insertErrCode,
    insertRaceExistingId = null,
    siteId = 'site-1',
    planId = 'starter',
  } = opts

  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  })

  // Server client — handles profiles, plans, sites lookups.
  mockFromServer.mockImplementation((table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { plan_id: planId }, error: null }),
          }),
        }),
      }
    }
    if (table === 'plans') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: planId
                  ? { supplementary_file_limit: planFileLimit }
                  : null,
                error: null,
              }),
          }),
        }),
      }
    }
    if (table === 'sites') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: siteId ? { id: siteId } : null,
                error: null,
              }),
          }),
        }),
      }
    }
    return {}
  })

  // Service client — supplementary_files + usage_counters + storage.
  const insertMock = vi.fn().mockResolvedValue(
    insertErrCode
      ? { error: { code: insertErrCode, message: 'conflict' } }
      : { error: null }
  )
  const deleteMock = vi.fn().mockReturnValue({
    eq: () => Promise.resolve({ error: null }),
  })

  // supplementary_files is called for:
  //   1. count: .select('*', {count:'exact',head:true}).eq(...) -> Promise
  //   2. dedupe: .select('id').eq(...).eq(...).maybeSingle()
  //   3. insert: .insert({...}) -> {error}
  //   4. post-race refetch: .select('id').eq(...).eq(...).maybeSingle()
  //   5. rollback: .delete().eq(...)
  //
  // We differentiate 1 from 2/4 by the `options` arg to select().
  let dedupeCallIdx = 0
  function makeSupFilesImpl() {
    return {
      select: (...args: unknown[]) => {
        const isCountCall =
          args.length > 1 &&
          typeof args[1] === 'object' &&
          args[1] !== null &&
          (args[1] as { head?: boolean }).head === true
        if (isCountCall) {
          return {
            eq: () =>
              Promise.resolve({ count: existingCount, error: null }),
          }
        }
        // 2-arg select or single-arg — dedupe / refetch paths
        return {
          eq: () => ({
            eq: () => ({
              maybeSingle: () => {
                dedupeCallIdx++
                if (dedupeCallIdx === 1) {
                  // pre-insert dedupe check
                  return Promise.resolve({
                    data: existingHashId ? { id: existingHashId } : null,
                    error: null,
                  })
                }
                // post-race refetch
                return Promise.resolve({
                  data: insertRaceExistingId
                    ? { id: insertRaceExistingId }
                    : null,
                  error: null,
                })
              },
            }),
          }),
        }
      },
      insert: insertMock,
      delete: deleteMock,
    }
  }

  mockFromService.mockImplementation((table: string) => {
    if (table === 'supplementary_files') return makeSupFilesImpl()
    if (table === 'usage_counters') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { files_stored: 3 },
                error: null,
              }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    }
    return {}
  })

  mockStorageFrom.mockReturnValue({ upload: mockStorageUpload })
  mockStorageUpload.mockResolvedValue({ error: null })

  return { insertMock, deleteMock }
}

function pdfBuffer(size = 1024): Uint8Array {
  const buf = new Uint8Array(size)
  buf[0] = 0x25
  buf[1] = 0x50
  buf[2] = 0x44
  buf[3] = 0x46
  buf[4] = 0x2d
  for (let i = 5; i < size; i++) buf[i] = 0x20
  return buf
}

/**
 * Build a Request-shaped mock that exposes formData()/headers.get().
 * jsdom's FormData round-trip via `new Request({body: fd})` loses the
 * filename + truncates bytes — so we skip the serialize step and hand
 * the handler a populated FormData directly.
 */
function makeRequest(
  filename: string,
  body: Uint8Array,
  type = 'application/pdf'
): Request {
  const file = new File([body.slice()], filename, { type })
  const fd = new FormData()
  fd.append('file', file)

  const headers = new Headers({
    'content-type': 'multipart/form-data; boundary=xxx',
    'content-length': String(body.byteLength),
  })

  return {
    headers,
    formData: async () => fd,
    method: 'POST',
    url: 'http://localhost/api/files',
  } as unknown as Request
}

describe('POST /api/files', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(makeRequest('doc.pdf', pdfBuffer()))
    expect(res.status).toBe(401)
  })

  it('VAL-FILE-010: returns 413 when file > 25MB', async () => {
    setup()
    const big = new Uint8Array(25 * 1024 * 1024 + 10)
    big[0] = 0x25
    big[1] = 0x50
    big[2] = 0x44
    big[3] = 0x46
    big[4] = 0x2d
    const res = await POST(makeRequest('big.pdf', big))
    expect(res.status).toBe(413)
  })

  it('VAL-FILE-021: returns 400 on 0-byte upload', async () => {
    setup()
    const res = await POST(makeRequest('empty.pdf', new Uint8Array(0)))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('empty_file')
  })

  it('rejects unsupported extension (.exe)', async () => {
    setup()
    const res = await POST(
      makeRequest('malware.exe', pdfBuffer(), 'application/octet-stream')
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('unsupported_type')
  })

  it('VAL-FILE-018: .pdf extension with non-PDF magic bytes rejected', async () => {
    setup()
    const fake = new TextEncoder().encode('definitely not a pdf')
    const res = await POST(makeRequest('fake.pdf', fake))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('mime_mismatch')
  })

  it('VAL-FILE-011: returns 403 when plan cap reached (Starter 25 at 25)', async () => {
    const { insertMock } = setup({ planFileLimit: 25, existingCount: 25 })
    const res = await POST(makeRequest('doc.pdf', pdfBuffer()))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('file_limit_exceeded')
    expect(body.limit).toBe(25)
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('VAL-FILE-012: duplicate content_hash returns {duplicate:true, existing_id}', async () => {
    const { insertMock } = setup({ existingHashId: 'file-existing-abc' })
    const res = await POST(makeRequest('doc.pdf', pdfBuffer()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duplicate).toBe(true)
    expect(body.existing_id).toBe('file-existing-abc')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('VAL-FILE-012 race: 23505 on insert returns duplicate with refetched id', async () => {
    setup({
      existingHashId: null,
      insertErrCode: '23505',
      insertRaceExistingId: 'file-race-xyz',
    })
    const res = await POST(makeRequest('doc.pdf', pdfBuffer()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.duplicate).toBe(true)
    expect(body.existing_id).toBe('file-race-xyz')
  })

  it('VAL-FILE-019: traversal filename sanitized in storage row', async () => {
    // The File constructor strips path separators from name, so we can't
    // simulate a crafted multipart via new File(). Build a File-like
    // object directly and stuff it into a mock FormData. A real attacker
    // can deliver the raw path this way via curl/Postman.
    const { insertMock } = setup()
    const body = pdfBuffer()
    const fileLike = {
      name: '../../etc/passwd.pdf',
      size: body.byteLength,
      type: 'application/pdf',
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    }
    const fd = new FormData()
    // TypeScript resists — cast through unknown.
    ;(fd as unknown as { append: (k: string, v: unknown) => void }).append(
      'file',
      fileLike
    )
    const req = {
      headers: new Headers({
        'content-type': 'multipart/form-data; boundary=xxx',
        'content-length': String(body.byteLength),
      }),
      formData: async () => ({
        get: () => fileLike,
      }) as unknown as FormData,
      method: 'POST',
      url: 'http://localhost/api/files',
    } as unknown as Request

    const res = await POST(req)
    expect(res.status).toBe(200)
    const insertArgs = insertMock.mock.calls[0][0] as { filename: string }
    expect(insertArgs.filename).toBe('etc_passwd.pdf')
  })

  it('happy path: 200 with file_id, storage upload called', async () => {
    setup()
    const res = await POST(makeRequest('report.pdf', pdfBuffer()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.file_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.filename).toBe('report.pdf')
    expect(body.status).toBe('queued')
    expect(mockStorageUpload).toHaveBeenCalledTimes(1)
    const [path] = mockStorageUpload.mock.calls[0]
    expect(path).toMatch(/^user-1\/[0-9a-f-]{36}\.pdf$/)
  })

  it('falls back to Starter cap (25) when caller has no plan_id', async () => {
    const { insertMock } = setup({
      planId: null,
      planFileLimit: 25,
      existingCount: 25,
    })
    const res = await POST(makeRequest('doc.pdf', pdfBuffer()))
    expect(res.status).toBe(403)
    expect(insertMock).not.toHaveBeenCalled()
  })
})
