/**
 * M5F4 file-delete-cascade — DELETE /api/files/{id} with ownership + cascade.
 *
 * Fulfills VAL-FILE-013 (delete cascades embeddings and storage). Cross-user
 * forbidden (404) verified via the RLS-returns-null path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockGetUser,
  mockFromServer,
  mockFromService,
  mockStorageRemove,
  mockStorageFrom,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFromServer: vi.fn(),
  mockFromService: vi.fn(),
  mockStorageRemove: vi.fn(),
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

import { DELETE } from '@/app/api/files/[id]/route'

function setup(opts: {
  authed?: boolean
  foundFile?: { id: string; storage_path: string } | null
  counterFilesStored?: number
} = {}) {
  const {
    authed = true,
    foundFile = { id: 'file-1', storage_path: 'user-1/file-1.pdf' },
    counterFilesStored = 3,
  } = opts

  mockGetUser.mockResolvedValue({
    data: { user: authed ? { id: 'user-1' } : null },
    error: null,
  })

  mockFromServer.mockImplementation((table: string) => {
    if (table === 'supplementary_files') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: foundFile, error: null }),
          }),
        }),
      }
    }
    return {}
  })

  const embeddingsDelete = vi.fn().mockReturnValue({
    eq: () => Promise.resolve({ error: null }),
  })
  const rowsDelete = vi.fn().mockReturnValue({
    eq: () => Promise.resolve({ error: null }),
  })
  const counterUpdate = vi.fn().mockReturnValue({
    eq: () => Promise.resolve({ error: null }),
  })

  mockFromService.mockImplementation((table: string) => {
    if (table === 'embeddings') {
      return { delete: embeddingsDelete }
    }
    if (table === 'supplementary_files') {
      return { delete: rowsDelete }
    }
    if (table === 'usage_counters') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: { files_stored: counterFilesStored },
                error: null,
              }),
          }),
        }),
        update: counterUpdate,
      }
    }
    return {}
  })

  mockStorageFrom.mockReturnValue({ remove: mockStorageRemove })
  mockStorageRemove.mockResolvedValue({ error: null })

  return { embeddingsDelete, rowsDelete, counterUpdate }
}

async function call(id: string) {
  return DELETE(new Request('http://localhost/'), {
    params: Promise.resolve({ id }),
  })
}

describe('DELETE /api/files/[id]', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    setup({ authed: false })
    const res = await call('file-1')
    expect(res.status).toBe(401)
  })

  it('returns 404 when the id is not visible to the caller (RLS filtered)', async () => {
    setup({ foundFile: null })
    const res = await call('file-other-user')
    expect(res.status).toBe(404)
  })

  it('VAL-FILE-013: deletes embeddings, storage object, and row; decrements files_stored', async () => {
    const { embeddingsDelete, rowsDelete, counterUpdate } = setup()
    const res = await call('file-1')
    expect(res.status).toBe(200)

    expect(mockStorageRemove).toHaveBeenCalledWith(['user-1/file-1.pdf'])
    expect(embeddingsDelete).toHaveBeenCalledTimes(1)
    expect(rowsDelete).toHaveBeenCalledTimes(1)
    expect(counterUpdate).toHaveBeenCalledTimes(1)
    const updateArgs = counterUpdate.mock.calls[0][0] as {
      files_stored: number
    }
    expect(updateArgs.files_stored).toBe(2) // 3 - 1
  })

  it('does not drop files_stored below 0', async () => {
    const { counterUpdate } = setup({ counterFilesStored: 0 })
    const res = await call('file-1')
    expect(res.status).toBe(200)
    const updateArgs = counterUpdate.mock.calls[0][0] as {
      files_stored: number
    }
    expect(updateArgs.files_stored).toBe(0)
  })

  it('ignores storage-remove errors (best-effort) and still completes DB cleanup', async () => {
    const { rowsDelete } = setup()
    mockStorageRemove.mockResolvedValue({
      error: { message: 'object_not_found' },
    })
    const res = await call('file-1')
    expect(res.status).toBe(200)
    expect(rowsDelete).toHaveBeenCalledTimes(1)
  })
})
