'use client'

import { useCallback, useState } from 'react'
import { toast } from '@/lib/toast'
import { Portal } from '@/components/portal'

export interface ResponseRuleRow {
  id: string
  trigger_type: 'keyword' | 'intent'
  triggers: string[]
  response: string
  priority: number
  is_active: boolean
  created_at: string
}

interface Props {
  initialRules: ResponseRuleRow[]
  siteId: string
}

interface DraftRule {
  id?: string
  trigger_type: 'keyword' | 'intent'
  triggers: string[]
  response: string
  priority: number
  is_active: boolean
}

const EMPTY_DRAFT: DraftRule = {
  trigger_type: 'keyword',
  triggers: [],
  response: '',
  priority: 0,
  is_active: true,
}

export function ResponsesClient({ initialRules, siteId }: Props) {
  const [rules, setRules] = useState<ResponseRuleRow[]>(initialRules)
  const [editing, setEditing] = useState<DraftRule | null>(null)
  const [testOpen, setTestOpen] = useState(false)
  // siteId is present for future per-site actions (bulk import/export);
  // today it's only used implicitly through the user's own RLS scope.
  void siteId

  const openAdd = useCallback(() => setEditing({ ...EMPTY_DRAFT }), [])
  const openEdit = useCallback(
    (rule: ResponseRuleRow) =>
      setEditing({
        id: rule.id,
        trigger_type: rule.trigger_type,
        triggers: [...rule.triggers],
        response: rule.response,
        priority: rule.priority,
        is_active: rule.is_active,
      }),
    []
  )

  const handleSave = useCallback(
    async (draft: DraftRule) => {
      const url = draft.id ? `/api/responses/${draft.id}` : '/api/responses'
      const method = draft.id ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          trigger_type: draft.trigger_type,
          triggers: draft.triggers,
          response: draft.response,
          priority: draft.priority,
          is_active: draft.is_active,
        }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'save failed')
        return
      }
      const body = (await res.json()) as { rule: ResponseRuleRow }
      setRules((prev) => {
        if (draft.id) {
          return prev.map((r) => (r.id === draft.id ? body.rule : r))
        }
        return [body.rule, ...prev]
      })
      toast.success(draft.id ? 'Rule updated' : 'Rule created')
      setEditing(null)
    },
    []
  )

  const handleDelete = useCallback(async (rule: ResponseRuleRow) => {
    if (!window.confirm(`Delete rule "${rule.triggers.join(', ')}"?`)) return
    const res = await fetch(`/api/responses/${rule.id}`, { method: 'DELETE' })
    if (!res.ok) {
      toast.error('Delete failed')
      return
    }
    setRules((prev) => prev.filter((r) => r.id !== rule.id))
    toast.success('Rule deleted')
  }, [])

  return (
    <div className="rc-enter">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
            Responses
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
            Custom responses.
          </h1>
          <p className="mt-3 max-w-lg text-sm text-[color:var(--ink-secondary)]">
            Intercept specific questions with canned answers — faster and
            exactly the wording you&rsquo;d use. Keyword rules skip the LLM
            entirely.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTestOpen(true)}
            className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-1.5 text-sm font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)]"
          >
            Test
          </button>
          <button
            type="button"
            onClick={openAdd}
            className="btn-press focus-ring rounded-md bg-[color:var(--ink-primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--bg-surface)] hover:opacity-90"
          >
            Add response
          </button>
        </div>
      </header>

      {rules.length === 0 ? (
        <div className="surface-hairline rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-[color:var(--ink-primary)]">
            No custom responses yet.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[color:var(--ink-tertiary)]">
            Add one to intercept common questions with your exact wording.
          </p>
          <button
            type="button"
            onClick={openAdd}
            className="btn-press focus-ring mt-4 rounded-md bg-[color:var(--ink-primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--bg-surface)] hover:opacity-90"
          >
            Add your first response
          </button>
        </div>
      ) : (
        <ul className="surface-hairline divide-y divide-[color:var(--border-hairline)] rounded-xl">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <TypeChip type={rule.trigger_type} />
                  <span className="font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                    priority {rule.priority}
                  </span>
                  {!rule.is_active && (
                    <span className="font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                      · paused
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {rule.triggers.map((t) => (
                    <TriggerChip key={t} text={t} />
                  ))}
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm text-[color:var(--ink-secondary)]">
                  {rule.response}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEdit(rule)}
                  className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)]"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(rule)}
                  className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[color:var(--accent-danger,#b91c1c)] hover:bg-red-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EditModal
          draft={editing}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      {testOpen && <TestDrawer onClose={() => setTestOpen(false)} />}
    </div>
  )
}

function TypeChip({ type }: { type: 'keyword' | 'intent' }) {
  const label = type === 'keyword' ? 'Keyword' : 'Intent'
  const cls =
    type === 'keyword'
      ? 'bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]'
      : 'bg-blue-50 text-blue-700'
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  )
}

function TriggerChip({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[color:var(--surface-inset)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ink-secondary)]">
      {text}
    </span>
  )
}

function EditModal({
  draft,
  onCancel,
  onSave,
}: {
  draft: DraftRule
  onCancel: () => void
  onSave: (d: DraftRule) => void | Promise<void>
}) {
  const [state, setState] = useState<DraftRule>(draft)
  const [triggerInput, setTriggerInput] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const addTrigger = useCallback(() => {
    const v = triggerInput.trim()
    if (!v) return
    setState((prev) =>
      prev.triggers.includes(v)
        ? prev
        : { ...prev, triggers: [...prev.triggers, v] }
    )
    setTriggerInput('')
  }, [triggerInput])

  const removeTrigger = useCallback((t: string) => {
    setState((prev) => ({
      ...prev,
      triggers: prev.triggers.filter((x) => x !== t),
    }))
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const nextErrors: Record<string, string> = {}
      if (state.triggers.length === 0) {
        nextErrors.triggers = 'Add at least one trigger'
      }
      if (!state.response.trim()) {
        nextErrors.response = 'Response is required'
      }
      setErrors(nextErrors)
      if (Object.keys(nextErrors).length > 0) return
      setSubmitting(true)
      try {
        await onSave(state)
      } finally {
        setSubmitting(false)
      }
    },
    [state, onSave]
  )

  return (
    <Portal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="response-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl bg-[color:var(--bg-surface)] p-6 shadow-xl"
      >
        <h2
          id="response-modal-title"
          className="text-lg font-semibold text-[color:var(--ink-primary)]"
        >
          {state.id ? 'Edit response' : 'Add response'}
        </h2>

        <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
          Trigger type
        </label>
        <select
          value={state.trigger_type}
          onChange={(e) =>
            setState((prev) => ({
              ...prev,
              trigger_type: e.target.value as 'keyword' | 'intent',
            }))
          }
          className="focus-ring mt-1 block w-full rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
        >
          <option value="keyword">Keyword (skips LLM)</option>
          <option value="intent">Intent (classifies with LLM)</option>
        </select>

        <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
          Triggers
        </label>
        <div className="mt-1 flex flex-wrap gap-1.5 rounded-md border border-[color:var(--border-hairline)] p-2">
          {state.triggers.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-[color:var(--surface-inset)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ink-secondary)]"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTrigger(t)}
                aria-label={`Remove ${t}`}
                className="ml-0.5 text-[color:var(--ink-tertiary)] hover:text-[color:var(--ink-primary)]"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            value={triggerInput}
            onChange={(e) => setTriggerInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTrigger()
              }
            }}
            onBlur={addTrigger}
            placeholder={
              state.triggers.length === 0 ? 'pricing, cost (press Enter)' : ''
            }
            className="min-w-[6rem] flex-1 border-0 bg-transparent text-sm outline-none"
          />
        </div>
        {errors.triggers && (
          <p className="mt-1 text-xs text-red-700">{errors.triggers}</p>
        )}

        <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
          Response
        </label>
        <textarea
          value={state.response}
          onChange={(e) =>
            setState((prev) => ({ ...prev, response: e.target.value }))
          }
          rows={4}
          maxLength={2000}
          className="focus-ring mt-1 block w-full rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          placeholder="Our pricing starts at $49/mo…"
        />
        {errors.response && (
          <p className="mt-1 text-xs text-red-700">{errors.response}</p>
        )}

        <div className="mt-4 flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-[color:var(--ink-primary)]">
            Priority
            <input
              type="number"
              value={state.priority}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  priority: Number.parseInt(e.target.value, 10) || 0,
                }))
              }
              min={0}
              max={100}
              className="focus-ring w-20 rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-2 py-1 text-sm"
            />
          </label>
          <label className="ml-auto flex items-center gap-2 text-sm text-[color:var(--ink-primary)]">
            <input
              type="checkbox"
              checked={state.is_active}
              onChange={(e) =>
                setState((prev) => ({ ...prev, is_active: e.target.checked }))
              }
            />
            Active
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-1.5 text-sm font-medium text-[color:var(--ink-primary)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="btn-press focus-ring rounded-md bg-[color:var(--ink-primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--bg-surface)] disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
    </Portal>
  )
}

interface TestResult {
  matched: boolean
  rule_id?: string
  response?: string
  via?: 'keyword' | 'intent'
  intent?: string
}

function TestDrawer({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<TestResult | null>(null)
  const [running, setRunning] = useState(false)

  const run = useCallback(async () => {
    if (!message.trim()) return
    setRunning(true)
    try {
      const res = await fetch('/api/responses/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      })
      if (!res.ok) {
        toast.error('Test failed')
        return
      }
      const body = (await res.json()) as TestResult
      setResult(body)
    } finally {
      setRunning(false)
    }
  }, [message])

  return (
    <Portal>
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-drawer-title"
        className="flex h-full w-full max-w-md flex-col bg-[color:var(--bg-surface)] p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2
            id="test-drawer-title"
            className="text-lg font-semibold text-[color:var(--ink-primary)]"
          >
            Test a message
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-press focus-ring rounded-md px-2 text-sm text-[color:var(--ink-tertiary)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="mt-2 text-sm text-[color:var(--ink-tertiary)]">
          Runs the same matcher the chat widget uses against your active rules.
        </p>

        <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
          Sample message
        </label>
        <textarea
          rows={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          className="focus-ring mt-1 block w-full rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          placeholder="What's the cost?"
        />
        <button
          type="button"
          onClick={run}
          disabled={running || !message.trim()}
          className="btn-press focus-ring mt-3 rounded-md bg-[color:var(--ink-primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--bg-surface)] disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run matcher'}
        </button>

        {result && (
          <div className="mt-6 rounded-md border border-[color:var(--border-hairline)] p-3 text-sm">
            {result.matched ? (
              <>
                <p className="font-medium text-[color:var(--ink-primary)]">
                  Matched
                  <span className="ml-2 font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                    via {result.via}
                    {result.intent ? ` · ${result.intent}` : ''}
                  </span>
                </p>
                <p className="mt-1 font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                  rule {result.rule_id}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-[color:var(--ink-primary)]">
                  {result.response}
                </p>
              </>
            ) : (
              <p className="text-[color:var(--ink-secondary)]">
                No rule matched — the widget would fall through to RAG.
              </p>
            )}
          </div>
        )}
      </aside>
    </div>
    </Portal>
  )
}
