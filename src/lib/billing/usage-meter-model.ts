/**
 * Pure helper for the UsageMeterSet component — maps a usage_counters row
 * + plan caps to {label, used, max, percentage} entries with the 100%
 * cap invariant applied (VAL-QUOTA-015).
 */

export interface UsageCounter {
  messages_used: number
  crawl_pages_used: number
  files_stored: number
}

export interface MeterCaps {
  monthly_message_limit: number
  monthly_crawl_page_limit: number
  supplementary_file_limit: number
}

export interface MeterRow {
  key: 'messages' | 'crawl_pages' | 'files'
  label: string
  used: number
  max: number
  /** Integer 0..100 — width safe for CSS `width: X%` without overshoot. */
  percent: number
}

export interface MeterSet {
  rows: MeterRow[]
}

const FALLBACK_CAPS: MeterCaps = {
  monthly_message_limit: 2000,
  monthly_crawl_page_limit: 500,
  supplementary_file_limit: 25,
}

export function buildMeterSet(input: {
  counter: UsageCounter | null
  caps: MeterCaps | null
}): MeterSet {
  const counter = input.counter ?? {
    messages_used: 0,
    crawl_pages_used: 0,
    files_stored: 0,
  }
  const caps = input.caps ?? FALLBACK_CAPS

  return {
    rows: [
      row('messages', 'Messages', counter.messages_used, caps.monthly_message_limit),
      row(
        'crawl_pages',
        'Crawl pages',
        counter.crawl_pages_used,
        caps.monthly_crawl_page_limit
      ),
      row('files', 'Files', counter.files_stored, caps.supplementary_file_limit),
    ],
  }
}

function row(
  key: MeterRow['key'],
  label: string,
  used: number,
  max: number
): MeterRow {
  const safeMax = max > 0 ? max : 1
  const pct = Math.round((used / safeMax) * 100)
  return {
    key,
    label,
    used,
    max,
    percent: Math.max(0, Math.min(100, pct)),
  }
}
