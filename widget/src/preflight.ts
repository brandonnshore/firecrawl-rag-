/**
 * Widget loader pre-flight (M8F6). Tiny, framework-free, safe for any
 * site. Resolves to:
 *   - 'ready'    -> the loader mounts the bubble
 *   - 'silent'   -> hide the bubble WITHOUT logging (402 sub-inactive, 404)
 *   - 'degraded' -> hide the bubble, log once, poll again later (5xx / network / timeout)
 *
 * The loader plumbs fetch in so tests can pass a fake. Real calls use
 * window.fetch.
 */

export interface PreflightInput {
  fetchFn: typeof fetch
  apiBase: string
  siteKey: string
  timeoutMs: number
}

export type PreflightStatus = 'ready' | 'silent' | 'degraded'

export interface PreflightResult {
  status: PreflightStatus
}

export async function preflightWidgetConfig({
  fetchFn,
  apiBase,
  siteKey,
  timeoutMs,
}: PreflightInput): Promise<PreflightResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `${apiBase}/api/widget/config?site_key=${encodeURIComponent(
      siteKey
    )}`
    const res = await fetchFn(url, {
      method: 'GET',
      signal: controller.signal,
    })
    if (res.ok) return { status: 'ready' }

    // 402 (subscription inactive) and 404 (missing site) are both
    // "silently hide". We don't want to expose billing status to visitors
    // and we don't want noisy console logs in the customer's browser for
    // a mistyped key.
    if (res.status === 402 || res.status === 404) {
      return { status: 'silent' }
    }

    // Anything else (5xx, 429) is transient — try again later.
    return { status: 'degraded' }
  } catch {
    // Network error, AbortError, TypeError. Always degrade.
    return { status: 'degraded' }
  } finally {
    clearTimeout(timer)
  }
}
