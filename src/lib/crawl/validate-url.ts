interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * Validates a URL for the crawl start API.
 *
 * Requirements:
 * - Must be a non-empty string
 * - Must be a valid URL with https:// protocol
 * - Must not point to localhost, loopback, or private IPs
 */
export function validateCrawlUrl(url: unknown): ValidationResult {
  if (typeof url !== 'string' || url.trim() === '') {
    return { valid: false, error: 'URL is required' }
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }

  // Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'URL must use https:// protocol' }
  }

  const hostname = parsed.hostname.toLowerCase()

  // Reject localhost
  if (hostname === 'localhost') {
    return { valid: false, error: 'localhost and private/internal URLs are not allowed' }
  }

  // Reject IPv6 loopback
  if (hostname === '[::1]' || hostname === '::1') {
    return { valid: false, error: 'localhost and private/internal URLs are not allowed' }
  }

  // Check for IP address patterns
  if (isPrivateOrReservedIP(hostname)) {
    return { valid: false, error: 'localhost and private/internal URLs are not allowed' }
  }

  return { valid: true }
}

/**
 * Checks if a hostname is a private, loopback, or reserved IP address.
 */
function isPrivateOrReservedIP(hostname: string): boolean {
  // Match IPv4 pattern
  const ipv4Match = hostname.match(
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
  )

  if (!ipv4Match) {
    return false
  }

  const [, a, b] = ipv4Match.map(Number)

  // 127.x.x.x — loopback
  if (a === 127) return true

  // 0.0.0.0
  if (a === 0 && b === 0) return true

  // 10.x.x.x — private
  if (a === 10) return true

  // 172.16.0.0 – 172.31.255.255 — private
  if (a === 172 && b >= 16 && b <= 31) return true

  // 192.168.x.x — private
  if (a === 192 && b === 168) return true

  return false
}
