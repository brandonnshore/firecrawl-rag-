/**
 * M5F3 file-parsers-pipeline — processFile orchestration tests.
 *
 * Uses the real parseFile + real chunkMarkdown but mocks Storage download,
 * OpenAI embeddings, and DB writes to avoid OpenAI spend and local-state
 * pollution. Asserts status transitions queued -> processing -> ready
 * (VAL-FILE-014) and error routing to 'failed' with error_message.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockFrom, mockStorageDownload, mockStorageFrom, mockEmbeddingsCreate } =
  vi.hoisted(() => ({
    mockFrom: vi.fn(),
    mockStorageDownload: vi.fn(),
    mockStorageFrom: vi.fn(),
    mockEmbeddingsCreate: vi.fn(),
  }))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: mockFrom,
    storage: { from: mockStorageFrom },
  }),
}))

vi.mock('openai', () => {
  const OpenAIMock = function (this: {
    embeddings: { create: typeof mockEmbeddingsCreate }
  }) {
    this.embeddings = { create: mockEmbeddingsCreate }
  } as unknown as typeof import('openai').default
  return { default: OpenAIMock }
})

import { processFile } from '@/lib/files/process'

interface Transition {
  status: string
  error_message?: string | null
  chunks_count?: number
}

function makeBlob(text: string): Blob {
  return new Blob([text], { type: 'text/plain' })
}

function setup(opts: {
  filename: string
  storagePath: string
  bytes?: Uint8Array
}): { transitions: Transition[]; embeddingsInserted: unknown[][] } {
  const transitions: Transition[] = []
  const embeddingsInserted: unknown[][] = []

  const blob =
    opts.bytes !== undefined
      ? new Blob([opts.bytes.slice()])
      : makeBlob(
          '# Hello\n\nThis is a substantive paragraph with enough content to produce at least one retrievable chunk for the knowledge base.'
        )

  mockFrom.mockImplementation((table: string) => {
    if (table === 'supplementary_files') {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({
                data: {
                  id: 'file-1',
                  site_id: 'site-1',
                  filename: opts.filename,
                  storage_path: opts.storagePath,
                },
                error: null,
              }),
          }),
        }),
        update: (patch: Transition) => {
          transitions.push(patch)
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    }
    if (table === 'embeddings') {
      return {
        insert: (rows: unknown[]) => {
          embeddingsInserted.push(rows)
          return Promise.resolve({ error: null })
        },
      }
    }
    return {}
  })

  mockStorageFrom.mockReturnValue({ download: mockStorageDownload })
  mockStorageDownload.mockResolvedValue({ data: blob, error: null })

  mockEmbeddingsCreate.mockImplementation(async ({ input }) => ({
    data: (input as string[]).map(() => ({
      embedding: new Array(1536).fill(0.1),
    })),
  }))

  return { transitions, embeddingsInserted }
}

describe('processFile orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('VAL-FILE-014: status transitions queued -> processing -> ready on TXT', async () => {
    const { transitions } = setup({
      filename: 'note.txt',
      storagePath: 'user-1/file-1.txt',
    })
    await processFile('file-1')

    const statuses = transitions.map((t) => t.status)
    expect(statuses).toEqual(['processing', 'ready'])
    const ready = transitions[transitions.length - 1]!
    expect(ready.chunks_count).toBeGreaterThan(0)
    expect(ready.error_message).toBeNull()
  })

  it('writes embeddings with source_type=file and file_id FK', async () => {
    const { embeddingsInserted } = setup({
      filename: 'note.md',
      storagePath: 'user-1/file-1.md',
    })
    await processFile('file-1')

    const firstRow = (embeddingsInserted[0] as Array<{
      source_type: string
      file_id: string
      source_url: string
      site_id: string
    }>)[0]
    expect(firstRow.source_type).toBe('file')
    expect(firstRow.file_id).toBe('file-1')
    expect(firstRow.source_url).toBe('file://note.md')
    expect(firstRow.site_id).toBe('site-1')
  })

  it('VAL-FILE-020: encrypted PDF -> status=failed with readable error', async () => {
    const encryptedPdf = new TextEncoder().encode(
      '%PDF-1.5\n1 0 obj\n/Encrypt 2 0 R\nendobj'
    )
    const { transitions } = setup({
      filename: 'locked.pdf',
      storagePath: 'user-1/file-1.pdf',
      bytes: encryptedPdf,
    })
    await processFile('file-1')

    const statuses = transitions.map((t) => t.status)
    expect(statuses).toContain('failed')
    const failed = transitions.find((t) => t.status === 'failed')!
    expect(failed.error_message).toMatch(/password-protected/i)
  })

  it('empty-extracted-text -> status=failed', async () => {
    const { transitions } = setup({
      filename: 'blank.md',
      storagePath: 'user-1/file-1.md',
      bytes: new TextEncoder().encode('   '),
    })
    await processFile('file-1')
    const failed = transitions.find((t) => t.status === 'failed')
    expect(failed).toBeDefined()
    expect(failed!.error_message).toMatch(/empty|no extractable/i)
  })

  it('storage download error -> status=failed', async () => {
    const { transitions } = setup({
      filename: 'note.md',
      storagePath: 'user-1/file-1.md',
    })
    mockStorageDownload.mockResolvedValue({
      data: null,
      error: { message: 'not found' },
    })
    await processFile('file-1')
    const failed = transitions.find((t) => t.status === 'failed')
    expect(failed).toBeDefined()
    expect(failed!.error_message).toBe('not found')
  })
})
