import { describe, it, expect } from 'vitest'
import { validateCrawlUrl } from '@/lib/crawl/validate-url'

describe('validateCrawlUrl', () => {
  // --- Valid HTTPS URLs ---
  it('accepts a valid HTTPS URL', () => {
    const result = validateCrawlUrl('https://example.com')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts HTTPS URL with path', () => {
    const result = validateCrawlUrl('https://example.com/about')
    expect(result.valid).toBe(true)
  })

  it('accepts HTTPS URL with subdomain', () => {
    const result = validateCrawlUrl('https://www.example.com')
    expect(result.valid).toBe(true)
  })

  it('accepts HTTPS URL with port', () => {
    const result = validateCrawlUrl('https://example.com:8443')
    expect(result.valid).toBe(true)
  })

  // --- Reject HTTP ---
  it('rejects HTTP URLs', () => {
    const result = validateCrawlUrl('http://example.com')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/https/i)
  })

  // --- Reject empty/malformed ---
  it('rejects empty string', () => {
    const result = validateCrawlUrl('')
    expect(result.valid).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('rejects undefined', () => {
    const result = validateCrawlUrl(undefined as unknown as string)
    expect(result.valid).toBe(false)
  })

  it('rejects null', () => {
    const result = validateCrawlUrl(null as unknown as string)
    expect(result.valid).toBe(false)
  })

  it('rejects non-string value', () => {
    const result = validateCrawlUrl(12345 as unknown as string)
    expect(result.valid).toBe(false)
  })

  it('rejects malformed URL', () => {
    const result = validateCrawlUrl('not-a-url')
    expect(result.valid).toBe(false)
  })

  it('rejects URL without protocol', () => {
    const result = validateCrawlUrl('example.com')
    expect(result.valid).toBe(false)
  })

  // --- Reject localhost ---
  it('rejects https://localhost', () => {
    const result = validateCrawlUrl('https://localhost')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/localhost|private|internal/i)
  })

  it('rejects https://localhost:3000', () => {
    const result = validateCrawlUrl('https://localhost:3000')
    expect(result.valid).toBe(false)
  })

  // --- Reject loopback IPs ---
  it('rejects https://127.0.0.1', () => {
    const result = validateCrawlUrl('https://127.0.0.1')
    expect(result.valid).toBe(false)
  })

  it('rejects https://0.0.0.0', () => {
    const result = validateCrawlUrl('https://0.0.0.0')
    expect(result.valid).toBe(false)
  })

  // --- Reject private IPs (10.x.x.x) ---
  it('rejects https://10.0.0.1', () => {
    const result = validateCrawlUrl('https://10.0.0.1')
    expect(result.valid).toBe(false)
  })

  it('rejects https://10.255.255.255', () => {
    const result = validateCrawlUrl('https://10.255.255.255')
    expect(result.valid).toBe(false)
  })

  // --- Reject private IPs (172.16-31.x.x) ---
  it('rejects https://172.16.0.1', () => {
    const result = validateCrawlUrl('https://172.16.0.1')
    expect(result.valid).toBe(false)
  })

  it('rejects https://172.31.255.255', () => {
    const result = validateCrawlUrl('https://172.31.255.255')
    expect(result.valid).toBe(false)
  })

  it('allows https://172.15.0.1 (not private)', () => {
    const result = validateCrawlUrl('https://172.15.0.1')
    expect(result.valid).toBe(true)
  })

  it('allows https://172.32.0.1 (not private)', () => {
    const result = validateCrawlUrl('https://172.32.0.1')
    expect(result.valid).toBe(true)
  })

  // --- Reject private IPs (192.168.x.x) ---
  it('rejects https://192.168.0.1', () => {
    const result = validateCrawlUrl('https://192.168.0.1')
    expect(result.valid).toBe(false)
  })

  it('rejects https://192.168.1.100', () => {
    const result = validateCrawlUrl('https://192.168.1.100')
    expect(result.valid).toBe(false)
  })

  // --- Reject other dangerous patterns ---
  it('rejects ftp:// protocol', () => {
    const result = validateCrawlUrl('ftp://example.com')
    expect(result.valid).toBe(false)
  })

  it('rejects javascript: protocol', () => {
    const result = validateCrawlUrl('javascript:alert(1)')
    expect(result.valid).toBe(false)
  })

  it('rejects data: protocol', () => {
    const result = validateCrawlUrl('data:text/html,<h1>hi</h1>')
    expect(result.valid).toBe(false)
  })

  // --- Reject IPv6 loopback ---
  it('rejects https://[::1]', () => {
    const result = validateCrawlUrl('https://[::1]')
    expect(result.valid).toBe(false)
  })
})
