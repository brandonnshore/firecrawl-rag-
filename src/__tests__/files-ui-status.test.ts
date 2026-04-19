import { describe, it, expect } from 'vitest'
import { statusChip, formatBytes } from '@/lib/files/ui-status'

describe('statusChip', () => {
  it.each([
    ['queued', 'Queued', 'neutral'],
    ['processing', 'Processing', 'info'],
    ['ready', 'Ready', 'success'],
    ['failed', 'Failed', 'danger'],
  ] as const)('maps %s -> {%s, %s}', (status, label, tone) => {
    expect(statusChip(status)).toEqual({ label, tone })
  })

  it('falls back gracefully for unknown status', () => {
    expect(statusChip('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('formatBytes', () => {
  it('formats bytes / KB / MB', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB')
  })
})
