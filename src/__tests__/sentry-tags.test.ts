import { describe, it, expect, vi, beforeEach } from 'vitest'

// M8F2 sentry-integration — proves that our helper tags every captured
// exception with environment, user_id, and request_id so Sentry filters
// can slice by tenant + deploy + request. VAL-HARD-010.

const captureException = vi.fn()
const withScope = vi.fn(
  (fn: (scope: { setTag: (k: string, v: string) => void }) => void) => {
    const tags: Record<string, string> = {}
    fn({
      setTag: (k, v) => {
        tags[k] = v
      },
    })
    ;(withScope as unknown as { lastTags: Record<string, string> }).lastTags =
      tags
  }
)

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
  withScope: (...args: unknown[]) =>
    (withScope as unknown as (...a: unknown[]) => void)(...args),
  init: vi.fn(),
}))

describe('captureApiError (M8F2)', () => {
  beforeEach(() => {
    captureException.mockClear()
    withScope.mockClear()
    delete process.env.VERCEL_ENV
    delete process.env.NEXT_PUBLIC_SENTRY_ENV
  })

  it('tags the event with the current NODE_ENV-derived environment', async () => {
    const { captureApiError } = await import('@/lib/sentry/capture')
    const err = new Error('boom')
    captureApiError(err, { userId: 'user-123', requestId: 'req-abc' })
    expect(captureException).toHaveBeenCalledWith(err)
    const tags = (withScope as unknown as { lastTags: Record<string, string> })
      .lastTags
    // Under vitest, NODE_ENV === 'test'. Production replaces this with
    // VERCEL_ENV via resolveEnvironment().
    expect(tags.environment).toBe(process.env.NODE_ENV || 'development')
  })

  it('uses VERCEL_ENV when present', async () => {
    process.env.VERCEL_ENV = 'preview'
    const { captureApiError } = await import('@/lib/sentry/capture')
    captureApiError(new Error('x'), {
      userId: 'u',
      requestId: 'r',
    })
    const tags = (withScope as unknown as { lastTags: Record<string, string> })
      .lastTags
    expect(tags.environment).toBe('preview')
  })

  it('attaches user_id and request_id tags from ctx', async () => {
    const { captureApiError } = await import('@/lib/sentry/capture')
    captureApiError(new Error('y'), {
      userId: 'user-42',
      requestId: 'req-xyz',
    })
    const tags = (withScope as unknown as { lastTags: Record<string, string> })
      .lastTags
    expect(tags.user_id).toBe('user-42')
    expect(tags.request_id).toBe('req-xyz')
  })

  it('omits user_id tag when userId is undefined (anonymous widget calls)', async () => {
    const { captureApiError } = await import('@/lib/sentry/capture')
    captureApiError(new Error('z'), { requestId: 'req-anon' })
    const tags = (withScope as unknown as { lastTags: Record<string, string> })
      .lastTags
    expect(tags.user_id).toBeUndefined()
    expect(tags.request_id).toBe('req-anon')
  })

  it('generates a fallback request_id when none is supplied', async () => {
    const { captureApiError } = await import('@/lib/sentry/capture')
    captureApiError(new Error('no-req'), { userId: 'u1' })
    const tags = (withScope as unknown as { lastTags: Record<string, string> })
      .lastTags
    expect(tags.request_id).toMatch(/^req-[a-z0-9-]+$/)
  })
})

describe('resolveRequestId (M8F2)', () => {
  it('prefers x-request-id header when present', async () => {
    const { resolveRequestId } = await import('@/lib/sentry/capture')
    const req = new Request('http://x', {
      headers: { 'x-request-id': 'client-abc' },
    })
    expect(resolveRequestId(req)).toBe('client-abc')
  })

  it('falls back to x-vercel-id when x-request-id is absent', async () => {
    const { resolveRequestId } = await import('@/lib/sentry/capture')
    const req = new Request('http://x', {
      headers: { 'x-vercel-id': 'iad1::abc-12345' },
    })
    expect(resolveRequestId(req)).toBe('iad1::abc-12345')
  })

  it('generates a req-<uuid> when neither header is present', async () => {
    const { resolveRequestId } = await import('@/lib/sentry/capture')
    const req = new Request('http://x')
    expect(resolveRequestId(req)).toMatch(/^req-[a-z0-9-]+$/)
  })
})
