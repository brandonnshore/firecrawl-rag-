import * as Sentry from '@sentry/nextjs'
import crypto from 'crypto'

export interface CaptureContext {
  userId?: string
  requestId?: string
}

function resolveEnvironment(): string {
  return (
    process.env.VERCEL_ENV ||
    process.env.NEXT_PUBLIC_SENTRY_ENV ||
    process.env.NODE_ENV ||
    'development'
  )
}

/**
 * Infer a stable request id from inbound headers. Vercel's x-vercel-id is
 * a reasonable default; client apps may forward their own x-request-id.
 * Falls back to a generated id so every captured event is correlatable.
 */
export function resolveRequestId(request: Request): string {
  return (
    request.headers.get('x-request-id') ||
    request.headers.get('x-vercel-id') ||
    `req-${crypto.randomUUID()}`
  )
}

/**
 * Capture an exception with the three tags Sentry filters on:
 *  - environment (production|preview|development)
 *  - user_id     (the authenticated owner, or omitted for anonymous)
 *  - request_id  (set by caller or generated here)
 *
 * Thin wrapper around Sentry.withScope so tag values don't leak between
 * concurrent requests.
 */
export function captureApiError(err: unknown, ctx: CaptureContext): void {
  Sentry.withScope((scope) => {
    scope.setTag('environment', resolveEnvironment())
    if (ctx.userId) scope.setTag('user_id', ctx.userId)
    scope.setTag(
      'request_id',
      ctx.requestId && ctx.requestId.length > 0
        ? ctx.requestId
        : `req-${crypto.randomUUID()}`
    )
    Sentry.captureException(err)
  })
}
