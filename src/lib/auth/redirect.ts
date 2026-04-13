/**
 * Validates a redirect path to prevent open redirect attacks.
 * Only allows relative paths (starting with '/').
 * Rejects absolute URLs, protocol-relative URLs, and any path
 * that could redirect to an external domain.
 */
export function sanitizeRedirectPath(path: string | null): string {
  const fallback = '/dashboard'

  if (!path) return fallback

  // Must start with exactly one '/' (reject protocol-relative "//evil.com")
  if (!path.startsWith('/') || path.startsWith('//')) {
    return fallback
  }

  // Reject if it contains a protocol (e.g., "/foo:bar" edge case)
  try {
    const url = new URL(path, 'http://localhost')
    // If the hostname changes from localhost, it's an absolute URL
    if (url.hostname !== 'localhost') {
      return fallback
    }
  } catch {
    return fallback
  }

  return path
}
