interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitMap = new Map<string, RateLimitEntry>()

const WINDOW_MS = 3000
const MAX_PER_WINDOW = 1

export function checkRateLimit(key: string): {
  allowed: boolean
  retryAfterMs?: number
} {
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap) {
      if (v.resetAt < now) rateLimitMap.delete(k)
    }
  }

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true }
  }

  if (entry.count >= MAX_PER_WINDOW) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }

  entry.count++
  return { allowed: true }
}

export function _resetRateLimit() {
  rateLimitMap.clear()
}
