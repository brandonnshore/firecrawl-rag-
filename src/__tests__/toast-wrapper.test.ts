/**
 * The toast wrapper is a thin forwarding layer over sonner. We don't
 * need to re-test sonner's rendering; we just verify our wrapper calls
 * sonner with the configured defaults (4s duration) and exposes the four
 * public methods (success/error/loading/dismiss).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const sonnerMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: sonnerMock,
}))

import { toast } from '@/lib/toast'

describe('lib/toast wrapper', () => {
  beforeEach(() => {
    sonnerMock.success.mockClear()
    sonnerMock.error.mockClear()
    sonnerMock.loading.mockClear()
    sonnerMock.dismiss.mockClear()
  })

  it('success forwards with 4000ms default duration', () => {
    toast.success('Saved')
    expect(sonnerMock.success).toHaveBeenCalledWith('Saved', { duration: 4000 })
  })

  it('error forwards with 4000ms default duration', () => {
    toast.error('Nope')
    expect(sonnerMock.error).toHaveBeenCalledWith('Nope', { duration: 4000 })
  })

  it('loading forwards without an auto-dismiss duration', () => {
    toast.loading('Working…')
    expect(sonnerMock.loading).toHaveBeenCalledWith('Working…')
  })

  it('dismiss forwards id', () => {
    toast.dismiss('tid-1')
    expect(sonnerMock.dismiss).toHaveBeenCalledWith('tid-1')
  })

  it('exports the four expected methods', () => {
    expect(typeof toast.success).toBe('function')
    expect(typeof toast.error).toBe('function')
    expect(typeof toast.loading).toBe('function')
    expect(typeof toast.dismiss).toBe('function')
  })
})
