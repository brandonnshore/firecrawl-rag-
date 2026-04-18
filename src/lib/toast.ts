/**
 * Thin wrapper around `sonner` with app-standard defaults.
 *
 * Used by settings saves, file uploads, responses / escalation persists,
 * and billing action feedback. Keeps the import surface small so the
 * toast library can be swapped later without touching call sites.
 */

import { toast as sonnerToast } from 'sonner'

const DEFAULT_DURATION_MS = 4000

export const toast = {
  success(message: string) {
    return sonnerToast.success(message, { duration: DEFAULT_DURATION_MS })
  },
  error(message: string) {
    return sonnerToast.error(message, { duration: DEFAULT_DURATION_MS })
  },
  loading(message: string) {
    return sonnerToast.loading(message)
  },
  dismiss(id?: string | number) {
    return sonnerToast.dismiss(id)
  },
}
