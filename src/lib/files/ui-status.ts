/**
 * Pure helpers for the knowledge UI: status chip styling + plan cap label.
 */

export type FileStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface StatusChip {
  label: string
  tone: 'info' | 'success' | 'warning' | 'danger' | 'neutral'
}

export function statusChip(status: FileStatus | string): StatusChip {
  switch (status) {
    case 'queued':
      return { label: 'Queued', tone: 'neutral' }
    case 'processing':
      return { label: 'Processing', tone: 'info' }
    case 'ready':
      return { label: 'Ready', tone: 'success' }
    case 'failed':
      return { label: 'Failed', tone: 'danger' }
    default:
      return { label: status, tone: 'neutral' }
  }
}

/** Format a byte count as a human string (e.g., 12.3 MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
