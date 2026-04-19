'use client'

import { useState } from 'react'
import { toast } from '@/lib/toast'

interface Props {
  userEmail: string
}

/**
 * GDPR "Delete my account" surface (VAL-GDPR-001/002/003).
 *
 * Two-step: red button opens the modal; modal requires typing the exact
 * email to enable Delete. Cancel is a pure close (zero side-effects).
 * Confirm calls DELETE /api/account then redirects to /.
 */
export function DeleteAccountSection({ userEmail }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const matches = typed.trim().toLowerCase() === userEmail.trim().toLowerCase()

  const close = () => {
    if (submitting) return
    setOpen(false)
    setTyped('')
  }

  const confirmDelete = async () => {
    if (!matches || submitting) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typed.trim() }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
        }
        toast.error(
          body.error === 'email_mismatch'
            ? "That email didn't match."
            : 'Could not delete account.'
        )
        setSubmitting(false)
        return
      }
      toast.success('Your account was deleted.')
      // Hard navigate so the middleware re-evaluates session (now invalid).
      window.location.assign('/')
    } catch {
      toast.error('Could not reach the server.')
      setSubmitting(false)
    }
  }

  return (
    <section className="mt-16 rounded-xl border border-red-200 bg-red-50/50 p-6">
      <h2 className="text-base font-semibold tracking-tight text-red-800">
        Delete my account
      </h2>
      <p className="mt-2 max-w-xl text-sm text-red-700/90">
        Permanently erases your site, crawled pages, uploaded files, chat
        transcripts, leads, and billing link. This cancels your subscription
        immediately and cannot be undone.
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-press focus-ring mt-4 rounded-lg border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
      >
        Delete my account
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="delete-account-title"
              className="text-base font-semibold text-red-800"
            >
              Confirm account deletion
            </h3>
            <p className="mt-2 text-sm text-[color:var(--ink-secondary)]">
              Type <strong>{userEmail}</strong> to confirm. This will cancel
              your subscription and delete all your data.
            </p>
            <label className="mt-4 block text-xs font-medium text-[color:var(--ink-secondary)]">
              Your email
            </label>
            <input
              type="email"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={submitting}
              placeholder={userEmail}
              className="mt-1 w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-subtle)] px-3 py-2 font-mono text-sm"
            />

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="btn-press focus-ring rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-4 py-2 text-sm font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={!matches || submitting}
                className="btn-press focus-ring rounded-lg border border-red-600 bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Deleting…' : 'Delete account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
