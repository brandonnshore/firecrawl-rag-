/**
 * Per-user rate limit for site-key rotation: 5 rotations per hour.
 * In-memory — fine while rotation volume is low; M8 migrates all
 * rate limiters to Upstash.
 */

interface Window {
  count: number
  resetAt: number
}

const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_WINDOW = 5

const store = new Map<string, Window>()

export function checkRotationRateLimit(userId: string): {
  allowed: boolean
  retryAfterMs?: number
} {
  const now = Date.now()
  const entry = store.get(userId)

  if (store.size > 10_000) {
    for (const [k, v] of store) if (v.resetAt < now) store.delete(k)
  }

  if (!entry || entry.resetAt < now) {
    store.set(userId, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true }
  }

  if (entry.count >= MAX_PER_WINDOW) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }

  entry.count++
  return { allowed: true }
}

export function _resetRotationRateLimit() {
  store.clear()
}
