'use client'

import { useCallback, useState } from 'react'
import { toast } from '@/lib/toast'
import { Portal } from '@/components/portal'

export type RuleType = 'turn_count' | 'keyword' | 'intent'
export type ActionType =
  | 'ask_email'
  | 'ask_phone'
  | 'show_form'
  | 'calendly_link'
  | 'handoff'

export interface EscalationRuleRow {
  id: string
  rule_type: RuleType
  config: Record<string, unknown>
  action: ActionType
  action_config: Record<string, unknown>
  priority: number
  is_active: boolean
  created_at: string
}

interface DraftRule {
  id?: string
  rule_type: RuleType
  // Typed view on config with wide defaults. Only the fields relevant
  // to the current rule_type are persisted.
  turns: number
  keywords: string[]
  intents: string[]
  action: ActionType
  calendlyUrl: string
  formFields: string[]
  priority: number
  is_active: boolean
}

const EMPTY_DRAFT: DraftRule = {
  rule_type: 'turn_count',
  turns: 3,
  keywords: [],
  intents: [],
  action: 'ask_email',
  calendlyUrl: '',
  formFields: [],
  priority: 0,
  is_active: true,
}

const ACTION_LABELS: Record<ActionType, string> = {
  ask_email: 'Ask for email',
  ask_phone: 'Ask for phone',
  show_form: 'Show form',
  calendly_link: 'Calendly link',
  handoff: 'Handoff to human',
}

const RULE_LABELS: Record<RuleType, string> = {
  turn_count: 'Turn count',
  keyword: 'Keyword',
  intent: 'Intent',
}

interface Props {
  initialRules: EscalationRuleRow[]
  siteId: string
}

export function EscalationClient({ initialRules, siteId }: Props) {
  const [rules, setRules] = useState<EscalationRuleRow[]>(initialRules)
  const [editing, setEditing] = useState<DraftRule | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  void siteId

  const openAdd = useCallback(() => setEditing({ ...EMPTY_DRAFT }), [])
  const openEdit = useCallback((rule: EscalationRuleRow) => {
    const cfg = (rule.config ?? {}) as Record<string, unknown>
    const ac = (rule.action_config ?? {}) as Record<string, unknown>
    setEditing({
      id: rule.id,
      rule_type: rule.rule_type,
      turns: typeof cfg.turns === 'number' ? (cfg.turns as number) : 3,
      keywords: Array.isArray(cfg.keywords) ? (cfg.keywords as string[]) : [],
      intents: Array.isArray(cfg.intents) ? (cfg.intents as string[]) : [],
      action: rule.action,
      calendlyUrl: typeof ac.url === 'string' ? (ac.url as string) : '',
      formFields: Array.isArray(ac.fields) ? (ac.fields as string[]) : [],
      priority: rule.priority,
      is_active: rule.is_active,
    })
  }, [])

  const handleSave = useCallback(
    async (draft: DraftRule) => {
      const config: Record<string, unknown> =
        draft.rule_type === 'turn_count'
          ? { turns: draft.turns }
          : draft.rule_type === 'keyword'
            ? { keywords: draft.keywords }
            : { intents: draft.intents }
      const action_config: Record<string, unknown> =
        draft.action === 'calendly_link'
          ? { url: draft.calendlyUrl }
          : draft.action === 'show_form'
            ? { fields: draft.formFields }
            : {}

      const url = draft.id
        ? `/api/escalation-rules/${draft.id}`
        : '/api/escalation-rules'
      const method = draft.id ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rule_type: draft.rule_type,
          config,
          action: draft.action,
          action_config,
          priority: draft.priority,
          is_active: draft.is_active,
        }),
      })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'save failed')
        return
      }
      const body = (await res.json()) as { rule: EscalationRuleRow }
      setRules((prev) => {
        if (draft.id) return prev.map((r) => (r.id === draft.id ? body.rule : r))
        // New rule goes to the top (highest priority) in the UI; the
        // reorder endpoint will be called if the user drags.
        return [body.rule, ...prev]
      })
      toast.success(draft.id ? 'Rule updated' : 'Rule created')
      setEditing(null)
    },
    []
  )

  const handleDelete = useCallback(async (rule: EscalationRuleRow) => {
    if (
      !window.confirm(
        `Delete ${RULE_LABELS[rule.rule_type]} rule → ${ACTION_LABELS[rule.action]}?`
      )
    )
      return
    const res = await fetch(`/api/escalation-rules/${rule.id}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      toast.error('Delete failed')
      return
    }
    setRules((prev) => prev.filter((r) => r.id !== rule.id))
    toast.success('Rule deleted')
  }, [])

  const persistOrder = useCallback(async (ordered: EscalationRuleRow[]) => {
    const res = await fetch('/api/escalation-rules/reorder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rule_ids: ordered.map((r) => r.id) }),
    })
    if (!res.ok) {
      toast.error('Reorder failed')
      return
    }
    toast.success('Order saved')
  }, [])

  const handleDrop = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null)
        return
      }
      setRules((prev) => {
        const source = prev.find((r) => r.id === dragId)
        if (!source) return prev
        const without = prev.filter((r) => r.id !== dragId)
        const targetIdx = without.findIndex((r) => r.id === targetId)
        if (targetIdx < 0) return prev
        const next = [
          ...without.slice(0, targetIdx),
          source,
          ...without.slice(targetIdx),
        ]
        // Fire-and-forget: UI reflects the reorder immediately; toast
        // on success / failure.
        void persistOrder(next)
        // Reflect new priorities locally so RuleCard shows the right
        // number without waiting for a refetch.
        return next.map((r, idx) => ({
          ...r,
          priority: next.length - idx,
        }))
      })
      setDragId(null)
    },
    [dragId, persistOrder]
  )

  return (
    <div className="rc-enter">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
            Escalation
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
            Escalation rules.
          </h1>
          <p className="mt-3 max-w-lg text-sm text-[color:var(--ink-secondary)]">
            Intercept the chat with a lead-capture form, a Calendly link, or a
            human handoff when a visitor hits a trigger. First-matching-rule-by-priority
            wins.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="btn-press focus-ring rounded-md bg-[color:var(--ink-primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--bg-surface)] hover:opacity-90"
        >
          Add rule
        </button>
      </header>

      {rules.length === 0 ? (
        <div className="surface-hairline rounded-xl p-10 text-center">
          <p className="text-sm font-medium text-[color:var(--ink-primary)]">
            No escalation rules yet.
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-[color:var(--ink-tertiary)]">
            Add one to capture leads or route urgent questions to a human.
          </p>
          <button
            type="button"
            onClick={openAdd}
            className="btn-press focus-ring mt-4 rounded-md bg-[color:var(--ink-primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--bg-surface)] hover:opacity-90"
          >
            Add your first rule
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              draggable
              onDragStart={() => setDragId(rule.id)}
              onDragOver={(e) => {
                e.preventDefault()
              }}
              onDrop={() => handleDrop(rule.id)}
              className={`surface-hairline flex items-start gap-3 rounded-xl px-4 py-3 transition ${
                dragId === rule.id ? 'opacity-60' : ''
              }`}
              data-testid="escalation-rule-card"
            >
              <span
                aria-label="Drag to reorder"
                className="cursor-grab pt-1 text-[color:var(--ink-tertiary)] select-none"
              >
                ⋮⋮
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <RuleTypeChip type={rule.rule_type} />
                  <span className="text-[color:var(--ink-tertiary)]">→</span>
                  <ActionChip action={rule.action} />
                  <span className="ml-auto font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                    priority {rule.priority}
                  </span>
                  {!rule.is_active && (
                    <span className="font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                      · paused
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-[color:var(--ink-secondary)]">
                  {summarizeRule(rule)}
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
    </div>
  )
}

function summarizeRule(rule: EscalationRuleRow): string {
  const cfg = (rule.config ?? {}) as Record<string, unknown>
  const trigger =
    rule.rule_type === 'turn_count'
      ? `After ${String(cfg.turns ?? '?')} turns`
      : rule.rule_type === 'keyword'
        ? `Message contains: ${((cfg.keywords as string[]) ?? []).join(', ')}`
        : `Intent matches: ${((cfg.intents as string[]) ?? []).join(', ')}`
  return `${trigger} → ${ACTION_LABELS[rule.action]}`
}

function RuleTypeChip({ type }: { type: RuleType }) {
  const tones: Record<RuleType, string> = {
    turn_count: 'bg-amber-50 text-amber-800',
    keyword: 'bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]',
    intent: 'bg-blue-50 text-blue-700',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tones[type]}`}
    >
      {RULE_LABELS[type]}
    </span>
  )
}

function ActionChip({ action }: { action: ActionType }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[color:var(--surface-inset)] px-2.5 py-0.5 text-[11px] font-medium text-[color:var(--ink-secondary)]">
      {ACTION_LABELS[action]}
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
  const [chipInput, setChipInput] = useState('')
  const [formFieldInput, setFormFieldInput] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const addChip = useCallback(
    (key: 'keywords' | 'intents') => {
      const v = chipInput.trim()
      if (!v) return
      setState((prev) =>
        prev[key].includes(v) ? prev : { ...prev, [key]: [...prev[key], v] }
      )
      setChipInput('')
    },
    [chipInput]
  )
  const removeChip = useCallback(
    (key: 'keywords' | 'intents', value: string) => {
      setState((prev) => ({
        ...prev,
        [key]: prev[key].filter((x) => x !== value),
      }))
    },
    []
  )
  const addFormField = useCallback(() => {
    const v = formFieldInput.trim()
    if (!v) return
    setState((prev) =>
      prev.formFields.includes(v)
        ? prev
        : { ...prev, formFields: [...prev.formFields, v] }
    )
    setFormFieldInput('')
  }, [formFieldInput])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const next: Record<string, string> = {}
      if (state.rule_type === 'turn_count' && state.turns < 1) {
        next.turns = 'Turns must be 1 or more'
      }
      if (state.rule_type === 'keyword' && state.keywords.length === 0) {
        next.keywords = 'Add at least one keyword'
      }
      if (state.rule_type === 'intent' && state.intents.length === 0) {
        next.intents = 'Add at least one intent label'
      }
      if (
        state.action === 'calendly_link' &&
        !/^https?:\/\//.test(state.calendlyUrl)
      ) {
        next.calendlyUrl = 'Must be a valid http(s) URL'
      }
      if (state.action === 'show_form' && state.formFields.length === 0) {
        next.formFields = 'Add at least one form field'
      }
      setErrors(next)
      if (Object.keys(next).length > 0) return
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
      aria-labelledby="escalation-modal-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl bg-[color:var(--bg-surface)] p-6 shadow-xl"
      >
        <h2
          id="escalation-modal-title"
          className="text-lg font-semibold text-[color:var(--ink-primary)]"
        >
          {state.id ? 'Edit rule' : 'Add rule'}
        </h2>

        <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
          Trigger
        </label>
        <select
          value={state.rule_type}
          onChange={(e) =>
            setState((prev) => ({
              ...prev,
              rule_type: e.target.value as RuleType,
            }))
          }
          className="focus-ring mt-1 block w-full rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
        >
          <option value="turn_count">Turn count — fires on Nth message</option>
          <option value="keyword">Keyword — fires on message match</option>
          <option value="intent">Intent — fires on classified intent</option>
        </select>

        {state.rule_type === 'turn_count' && (
          <>
            <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
              After how many user turns?
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={state.turns}
              onChange={(e) =>
                setState((prev) => ({
                  ...prev,
                  turns: Number.parseInt(e.target.value, 10) || 0,
                }))
              }
              className="focus-ring mt-1 w-32 rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
            />
            {errors.turns && (
              <p className="mt-1 text-xs text-red-700">{errors.turns}</p>
            )}
          </>
        )}

        {(state.rule_type === 'keyword' || state.rule_type === 'intent') && (
          <>
            <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
              {state.rule_type === 'keyword' ? 'Keywords' : 'Intent labels'}
            </label>
            <ChipInput
              values={
                state.rule_type === 'keyword' ? state.keywords : state.intents
              }
              onAdd={() =>
                addChip(state.rule_type === 'keyword' ? 'keywords' : 'intents')
              }
              onRemove={(v) =>
                removeChip(
                  state.rule_type === 'keyword' ? 'keywords' : 'intents',
                  v
                )
              }
              input={chipInput}
              setInput={setChipInput}
              placeholder={
                state.rule_type === 'keyword'
                  ? 'price, refund (press Enter)'
                  : 'complaint, billing (press Enter)'
              }
            />
            {(errors.keywords || errors.intents) && (
              <p className="mt-1 text-xs text-red-700">
                {errors.keywords || errors.intents}
              </p>
            )}
          </>
        )}

        <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
          Action
        </label>
        <select
          value={state.action}
          onChange={(e) =>
            setState((prev) => ({
              ...prev,
              action: e.target.value as ActionType,
            }))
          }
          className="focus-ring mt-1 block w-full rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
        >
          {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a]}
            </option>
          ))}
        </select>

        {state.action === 'calendly_link' && (
          <>
            <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
              Calendly URL
            </label>
            <input
              type="url"
              value={state.calendlyUrl}
              onChange={(e) =>
                setState((prev) => ({ ...prev, calendlyUrl: e.target.value }))
              }
              placeholder="https://calendly.com/your-handle"
              className="focus-ring mt-1 block w-full rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
            />
            {errors.calendlyUrl && (
              <p className="mt-1 text-xs text-red-700">{errors.calendlyUrl}</p>
            )}
          </>
        )}

        {state.action === 'show_form' && (
          <>
            <label className="mt-4 block text-sm font-medium text-[color:var(--ink-primary)]">
              Form fields
            </label>
            <ChipInput
              values={state.formFields}
              onAdd={addFormField}
              onRemove={(v) =>
                setState((prev) => ({
                  ...prev,
                  formFields: prev.formFields.filter((x) => x !== v),
                }))
              }
              input={formFieldInput}
              setInput={setFormFieldInput}
              placeholder="name, phone, message (press Enter)"
            />
            {errors.formFields && (
              <p className="mt-1 text-xs text-red-700">{errors.formFields}</p>
            )}
          </>
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

function ChipInput({
  values,
  onAdd,
  onRemove,
  input,
  setInput,
  placeholder,
}: {
  values: string[]
  onAdd: () => void
  onRemove: (v: string) => void
  input: string
  setInput: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1.5 rounded-md border border-[color:var(--border-hairline)] p-2">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex items-center gap-1 rounded-full bg-[color:var(--surface-inset)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--ink-secondary)]"
        >
          {v}
          <button
            type="button"
            onClick={() => onRemove(v)}
            aria-label={`Remove ${v}`}
            className="ml-0.5 text-[color:var(--ink-tertiary)] hover:text-[color:var(--ink-primary)]"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            onAdd()
          }
        }}
        onBlur={onAdd}
        placeholder={values.length === 0 ? placeholder : ''}
        className="min-w-[6rem] flex-1 border-0 bg-transparent text-sm outline-none"
      />
    </div>
  )
}
