import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { checkRateLimit, _resetRateLimit } from '@/lib/chat/rate-limit'

describe('checkRateLimit', () => {
  beforeEach(() => {
    _resetRateLimit()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows first request', async () => {
    const result = await checkRateLimit('visitor:site1')
    expect(result.allowed).toBe(true)
  })

  it('blocks rapid second request within window', async () => {
    await checkRateLimit('visitor:site1')
    const result = await checkRateLimit('visitor:site1')
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('allows request after window expires', async () => {
    await checkRateLimit('visitor:site1')
    vi.advanceTimersByTime(3100)
    const result = await checkRateLimit('visitor:site1')
    expect(result.allowed).toBe(true)
  })

  it('isolates different keys', async () => {
    await checkRateLimit('visitor1:site1')
    const result = await checkRateLimit('visitor2:site1')
    expect(result.allowed).toBe(true)
  })
})
