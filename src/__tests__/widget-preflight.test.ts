import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { preflightWidgetConfig } from '../../widget/src/preflight'

// M8F6 graceful-widget-degradation — the widget loader pre-flights the
// config endpoint and only mounts the bubble if the site is ready. A
// 5xx / network error / timeout maps to a "degraded" retry. 402 maps to
// a "silent hidden" state — we never surface billing to the visitor.

describe('preflightWidgetConfig (M8F6)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-19T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns 'ready' when the endpoint answers 200 ready:true", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ready: true }),
    })
    const res = await preflightWidgetConfig({
      fetchFn,
      apiBase: 'https://api',
      siteKey: 'sk_abc',
      timeoutMs: 3000,
    })
    expect(res.status).toBe('ready')
  })

  it("returns 'silent' on 402 (subscription inactive — VAL-DEGRADE-003)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ error: 'subscription_inactive' }),
    })
    const res = await preflightWidgetConfig({
      fetchFn,
      apiBase: 'https://api',
      siteKey: 'sk_abc',
      timeoutMs: 3000,
    })
    expect(res.status).toBe('silent')
  })

  it("returns 'degraded' on 5xx (VAL-DEGRADE-001)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    })
    const res = await preflightWidgetConfig({
      fetchFn,
      apiBase: 'https://api',
      siteKey: 'sk_abc',
      timeoutMs: 3000,
    })
    expect(res.status).toBe('degraded')
  })

  it("returns 'degraded' on network error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await preflightWidgetConfig({
      fetchFn,
      apiBase: 'https://api',
      siteKey: 'sk_abc',
      timeoutMs: 3000,
    })
    expect(res.status).toBe('degraded')
  })

  it("returns 'degraded' on >3s timeout (AbortError)", async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const fetchFn = vi.fn().mockRejectedValue(abortErr)
    const res = await preflightWidgetConfig({
      fetchFn,
      apiBase: 'https://api',
      siteKey: 'sk_abc',
      timeoutMs: 3000,
    })
    expect(res.status).toBe('degraded')
  })

  it("treats 404 (site key not found) as 'degraded' — never surfaces the raw error", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_found' }),
    })
    const res = await preflightWidgetConfig({
      fetchFn,
      apiBase: 'https://api',
      siteKey: 'sk_abc',
      timeoutMs: 3000,
    })
    // 404 indicates either an invalid key or the site hasn't finished
    // seeding — either way, hide the bubble silently.
    expect(res.status).toBe('silent')
  })

  it('uses an AbortController to enforce the timeout', async () => {
    const signals: AbortSignal[] = []
    const fetchFn = vi.fn().mockImplementation((_url, init) => {
      signals.push(init.signal)
      return new Promise((_, reject) => {
        // Mirror real fetch: reject with AbortError when the signal aborts.
        init.signal.addEventListener('abort', () => {
          reject(
            Object.assign(new Error('The operation was aborted.'), {
              name: 'AbortError',
            })
          )
        })
      })
    })
    const p = preflightWidgetConfig({
      fetchFn,
      apiBase: 'https://api',
      siteKey: 'sk_abc',
      timeoutMs: 3000,
    })
    await vi.advanceTimersByTimeAsync(3100)
    const res = await p
    expect(res.status).toBe('degraded')
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(true)
  })
})
