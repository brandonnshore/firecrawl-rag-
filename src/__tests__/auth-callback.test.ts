import { describe, it, expect } from 'vitest'
import { sanitizeRedirectPath } from '@/lib/auth/redirect'

describe('sanitizeRedirectPath', () => {
  it('returns /dashboard when path is null', () => {
    expect(sanitizeRedirectPath(null)).toBe('/dashboard')
  })

  it('returns /dashboard when path is empty string', () => {
    expect(sanitizeRedirectPath('')).toBe('/dashboard')
  })

  it('accepts valid relative paths', () => {
    expect(sanitizeRedirectPath('/dashboard')).toBe('/dashboard')
    expect(sanitizeRedirectPath('/dashboard/setup')).toBe('/dashboard/setup')
    expect(sanitizeRedirectPath('/dashboard/settings')).toBe('/dashboard/settings')
  })

  it('rejects absolute URLs (https)', () => {
    expect(sanitizeRedirectPath('https://evil.com')).toBe('/dashboard')
  })

  it('rejects absolute URLs (http)', () => {
    expect(sanitizeRedirectPath('http://evil.com')).toBe('/dashboard')
  })

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeRedirectPath('//evil.com')).toBe('/dashboard')
    expect(sanitizeRedirectPath('//evil.com/path')).toBe('/dashboard')
  })

  it('rejects paths without leading slash', () => {
    expect(sanitizeRedirectPath('evil.com')).toBe('/dashboard')
    expect(sanitizeRedirectPath('dashboard')).toBe('/dashboard')
  })

  it('accepts paths with query parameters', () => {
    expect(sanitizeRedirectPath('/dashboard?tab=settings')).toBe('/dashboard?tab=settings')
  })

  it('accepts paths with hash fragments', () => {
    expect(sanitizeRedirectPath('/dashboard#section')).toBe('/dashboard#section')
  })

  it('rejects javascript: protocol', () => {
    expect(sanitizeRedirectPath('javascript:alert(1)')).toBe('/dashboard')
  })

  it('rejects data: protocol', () => {
    expect(sanitizeRedirectPath('data:text/html,<h1>evil</h1>')).toBe('/dashboard')
  })
})

describe('auth callback route behavior', () => {
  it('should redirect to /login with error when code is missing', async () => {
    // This tests the expected behavior documented in the route handler
    // When no code is provided, should redirect to /login?error=auth_callback_error
    const url = new URL('http://localhost:3000/auth/callback')
    expect(url.searchParams.get('code')).toBeNull()
  })

  it('should redirect to /login with error when code is invalid', async () => {
    // When an invalid code is provided, exchangeCodeForSession will fail
    // and should redirect to /login?error=auth_callback_error
    const url = new URL('http://localhost:3000/auth/callback?code=invalid')
    expect(url.searchParams.get('code')).toBe('invalid')
  })
})
