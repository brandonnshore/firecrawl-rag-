'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/toast'
import {
  statusChip,
  formatBytes,
  type FileStatus,
} from '@/lib/files/ui-status'
import { ALLOWED_EXTENSIONS } from '@/lib/files/validate'

interface FileRow {
  id: string
  filename: string
  bytes: number
  status: FileStatus
  error_message: string | null
  chunks_count: number
  created_at: string
}

interface Props {
  initialFiles: FileRow[]
  siteId: string
  userId: string
  fileLimit: number
}

export function KnowledgeClient({
  initialFiles,
  siteId,
  userId,
  fileLimit,
}: Props) {
  const [files, setFiles] = useState<FileRow[]>(initialFiles)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Live status updates via Supabase Realtime on supplementary_files.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`supplementary_files:site:${siteId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'supplementary_files',
          filter: `site_id=eq.${siteId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const row = payload.new as FileRow
            setFiles((prev) => {
              if (prev.some((f) => f.id === row.id)) return prev
              return [row, ...prev]
            })
            return
          }
          if (payload.eventType === 'UPDATE') {
            const row = payload.new as FileRow
            setFiles((prev) =>
              prev.map((f) => (f.id === row.id ? { ...f, ...row } : f))
            )
            return
          }
          if (payload.eventType === 'DELETE') {
            const row = payload.old as { id: string }
            setFiles((prev) => prev.filter((f) => f.id !== row.id))
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [siteId])

  const uploadOne = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
        toast.error(`${file.name}: unsupported file type`)
        return
      }
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/files', { method: 'POST', body: fd })
      if (!res.ok) {
        const body: { error?: string } = await res.json().catch(() => ({}))
        toast.error(`${file.name}: ${body.error ?? 'upload failed'}`)
        return
      }
      const body: { duplicate?: boolean } = await res.json().catch(() => ({}))
      if (body.duplicate) {
        toast.success(`${file.name} already uploaded`)
      } else {
        toast.success(`${file.name} queued`)
      }
    },
    []
  )

  const handleFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return
      setUploading(true)
      try {
        for (const file of Array.from(list)) {
          await uploadOne(file)
        }
      } finally {
        setUploading(false)
      }
    },
    [uploadOne]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragging(false)
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles]
  )

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (
      !window.confirm(
        `Delete "${name}"? Embeddings sourced from this file will also be removed.`
      )
    ) {
      return
    }
    const res = await fetch(`/api/files/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const body: { error?: string } = await res.json().catch(() => ({}))
      toast.error(body.error ?? 'delete failed')
      return
    }
    toast.success('File deleted')
    // Realtime DELETE event will also fire, but remove locally for immediacy.
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const handleRetry = useCallback(async (id: string) => {
    const res = await fetch('/api/files/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: id }),
    })
    if (!res.ok) {
      toast.error('Retry failed')
      return
    }
    toast.success('Retrying…')
  }, [])

  return (
    <div className="rc-enter">
      <header className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          Knowledge
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[color:var(--ink-primary)]">
          Knowledge uploads.
        </h1>
        <p className="mt-3 max-w-lg text-sm text-[color:var(--ink-secondary)]">
          Upload PDFs, docs, and spreadsheets the chatbot should answer from.
          Files are embedded alongside your crawled pages. {files.length} /{' '}
          {fileLimit} used.
        </p>
      </header>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
          dragging
            ? 'border-[color:var(--ink-primary)] bg-[color:var(--bg-subtle)]'
            : 'border-[color:var(--border-hairline)]'
        }`}
      >
        <p className="text-sm text-[color:var(--ink-primary)]">
          Drop files here, or{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="underline underline-offset-2 hover:text-[color:var(--ink-secondary)]"
          >
            browse
          </button>
          .
        </p>
        <p className="mt-2 text-xs text-[color:var(--ink-tertiary)]">
          PDF, DOCX, PPTX, XLSX, CSV, TXT, MD · Max 25MB per file
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploading ? (
          <p className="mt-3 text-xs text-[color:var(--ink-tertiary)]">
            Uploading…
          </p>
        ) : null}
      </div>

      {/* File list / empty state */}
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-[color:var(--ink-primary)]">
          Uploaded files
        </h2>
        {files.length === 0 ? (
          <p className="surface-hairline rounded-xl p-6 text-sm text-[color:var(--ink-tertiary)]">
            No files yet. Drop one above to get started.
          </p>
        ) : (
          <ul className="surface-hairline divide-y divide-[color:var(--border-hairline)] rounded-xl">
            {files.map((file) => {
              const chip = statusChip(file.status)
              return (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[color:var(--ink-primary)]">
                      {file.filename}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-[color:var(--ink-tertiary)]">
                      {formatBytes(file.bytes)} · {file.chunks_count} chunks
                    </p>
                    {file.status === 'failed' && file.error_message ? (
                      <p className="mt-1 text-xs text-red-700">
                        {file.error_message}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip chip={chip} />
                    {file.status === 'failed' ? (
                      <button
                        type="button"
                        onClick={() => handleRetry(file.id)}
                        className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[color:var(--ink-primary)] hover:bg-[color:var(--bg-subtle)]"
                      >
                        Retry
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => handleDelete(file.id, file.filename)}
                      className="btn-press focus-ring rounded-md border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-2.5 py-1 text-xs font-medium text-[color:var(--accent-danger,#b91c1c)] hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {void userId /* userId available for future per-user operations */}
    </div>
  )
}

function Chip({ chip }: { chip: { label: string; tone: string } }) {
  const tones: Record<string, string> = {
    success:
      'bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]',
    info: 'bg-blue-50 text-blue-700',
    warning: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-700',
    neutral:
      'bg-[color:var(--surface-inset)] text-[color:var(--ink-secondary)]',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tones[chip.tone] ?? tones.neutral}`}
    >
      {chip.label}
    </span>
  )
}
