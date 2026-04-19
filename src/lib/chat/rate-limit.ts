import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Rate limiter with Upstash Redis backing and an in-memory fallback.
 *
 * Upstash is used when both UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set (Vercel production). Otherwise a
 * process-local Map is used — fine for dev and tests, but state resets on
 * cold starts. VAL-HARD-001 ("persists across cold starts") is therefore
 * satisfied by the Upstash path; the in-memory fallback exists so tests
 * can run without an Upstash account.
 */

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs?: number
}

interface RateRule {
  limit: number
  windowMs: number
  prefix: string
}

const CHAT_RULE: RateRule = {
  limit: 1,
  windowMs: 3_000,
  prefix: 'rl:chat',
}

const CRAWL_RULE: RateRule = {
  limit: 5,
  windowMs: 3_600_000,
  prefix: 'rl:crawl',
}

const FILE_RULE: RateRule = {
  limit: 60,
  windowMs: 3_600_000,
  prefix: 'rl:file',
}

interface MemoryEntry {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, MemoryEntry>()

let cachedRedis: Redis | null = null
let upstashChecked = false

function getRedis(): Redis | null {
  if (upstashChecked) return cachedRedis
  upstashChecked = true
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  try {
    cachedRedis = new Redis({ url, token })
  } catch {
    cachedRedis = null
  }
  return cachedRedis
}

const limiterCache = new Map<string, Ratelimit>()

function getUpstashLimiter(rule: RateRule, redis: Redis): Ratelimit {
  const key = `${rule.prefix}:${rule.limit}:${rule.windowMs}`
  const existing = limiterCache.get(key)
  if (existing) return existing
  const windowSeconds = Math.max(1, Math.floor(rule.windowMs / 1000))
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(rule.limit, `${windowSeconds} s`),
    prefix: rule.prefix,
    analytics: false,
  })
  limiterCache.set(key, limiter)
  return limiter
}

async function checkWithRule(
  rule: RateRule,
  key: string
): Promise<RateLimitResult> {
  const redis = getRedis()
  if (redis) {
    const limiter = getUpstashLimiter(rule, redis)
    const res = await limiter.limit(`${rule.prefix}:${key}`)
    if (res.success) return { allowed: true }
    const retryAfterMs = Math.max(0, res.reset - Date.now())
    return { allowed: false, retryAfterMs }
  }
  return checkWithMemory(rule, key)
}

function checkWithMemory(rule: RateRule, key: string): RateLimitResult {
  const now = Date.now()
  const storeKey = `${rule.prefix}:${key}`
  const entry = memoryStore.get(storeKey)

  if (memoryStore.size > 10000) {
    for (const [k, v] of memoryStore) {
      if (v.resetAt < now) memoryStore.delete(k)
    }
  }

  if (!entry || entry.resetAt < now) {
    memoryStore.set(storeKey, { count: 1, resetAt: now + rule.windowMs })
    return { allowed: true }
  }

  if (entry.count >= rule.limit) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }

  entry.count++
  return { allowed: true }
}

export async function checkChatRateLimit(
  key: string
): Promise<RateLimitResult> {
  return checkWithRule(CHAT_RULE, key)
}

export async function checkCrawlRateLimit(
  userId: string
): Promise<RateLimitResult> {
  return checkWithRule(CRAWL_RULE, userId)
}

export async function checkFileUploadRateLimit(
  userId: string
): Promise<RateLimitResult> {
  return checkWithRule(FILE_RULE, userId)
}

// Back-compat alias — the widget chat + leads routes call this. New code
// should use the named limiter appropriate for the endpoint.
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  return checkChatRateLimit(key)
}

export function _resetRateLimit(): void {
  memoryStore.clear()
  limiterCache.clear()
  upstashChecked = false
  cachedRedis = null
}
