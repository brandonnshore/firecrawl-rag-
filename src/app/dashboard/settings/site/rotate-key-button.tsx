'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'

interface Props {
  onRotated: (newKey: string) => void
}

/**
 * Rotate-site-key button + confirmation modal.
 *
 * Flow:
 *   click -> native <dialog> modal with warning copy -> confirm -> POST
 *   /api/sites/rotate-key -> toast on success + onRotated(newKey) -> the
 *   parent updates its displayed key -> router.refresh() so any cached
 *   server-rendered embed snippet (re-fetched on navigation) is current.
 */
export function RotateKeyButton({ onRotated }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  const open = useCallback(() => {
    dialogRef.current?.showModal()
  }, [])

  const close = useCallback(() => {
    dialogRef.current?.close()
  }, [])

  const confirm = useCallback(async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/sites/rotate-key', { method: 'POST' })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        toast.error(body.error || 'Failed to rotate site key.')
        return
      }
      const body = (await res.json()) as { site_key?: string }
      if (body.site_key) {
        onRotated(body.site_key)
        toast.success('Site key rotated')
        router.refresh()
      } else {
        toast.error('Rotated but key missing in response.')
      }
      close()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }, [onRotated, router, close])

  // Close on Escape — <dialog> handles this natively, but we also reset
  // submitting state if the user escapes mid-submit.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const handleClose = () => setSubmitting(false)
    el.addEventListener('close', handleClose)
    return () => el.removeEventListener('close', handleClose)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-xs font-medium text-[color:var(--accent-danger)] hover:border-[color:var(--accent-danger)]/30"
      >
        Rotate key
      </button>

      <dialog
        ref={dialogRef}
        className="w-full max-w-md rounded-xl border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] p-6 shadow-xl backdrop:bg-black/30 backdrop:backdrop-blur-sm"
        onClick={(e) => {
          // Click outside the inner content closes the modal.
          if (e.target === dialogRef.current) close()
        }}
      >
        <h2 className="text-lg font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Rotate site key?
        </h2>
        <p className="mt-2 text-sm text-[color:var(--ink-secondary)]">
          This will immediately invalidate the current site key. Your widget
          will stop answering chat until you re-embed with the new key.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="btn-press focus-ring rounded-md bg-[color:var(--accent-danger,#b91c1c)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? 'Rotating…' : 'Rotate key'}
          </button>
        </div>
      </dialog>
    </>
  )
}
