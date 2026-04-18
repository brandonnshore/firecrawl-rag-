import { describe, it, expect } from 'vitest'
import { buildMeterSet } from '@/lib/billing/usage-meter-model'

const CAPS = {
  monthly_message_limit: 2000,
  monthly_crawl_page_limit: 500,
  supplementary_file_limit: 25,
}

describe('buildMeterSet', () => {
  it('renders 3 rows in fixed order: messages, crawl_pages, files', () => {
    const { rows } = buildMeterSet({
      counter: { messages_used: 100, crawl_pages_used: 30, files_stored: 5 },
      caps: CAPS,
    })
    expect(rows.map((r) => r.key)).toEqual(['messages', 'crawl_pages', 'files'])
  })

  it('VAL-QUOTA-014: empty state renders 0 / cap cleanly', () => {
    const { rows } = buildMeterSet({ counter: null, caps: CAPS })
    expect(rows[0]).toEqual({
      key: 'messages',
      label: 'Messages',
      used: 0,
      max: 2000,
      percent: 0,
    })
  })

  it('VAL-QUOTA-015: overshoot caps at 100%', () => {
    const { rows } = buildMeterSet({
      counter: { messages_used: 2500, crawl_pages_used: 600, files_stored: 30 },
      caps: CAPS,
    })
    expect(rows[0].percent).toBe(100)
    expect(rows[1].percent).toBe(100)
    expect(rows[2].percent).toBe(100)
    // Raw used value still surfaced so UI can display "2500 / 2000".
    expect(rows[0].used).toBe(2500)
  })

  it('percent rounds to nearest integer', () => {
    const { rows } = buildMeterSet({
      counter: { messages_used: 333, crawl_pages_used: 0, files_stored: 0 },
      caps: CAPS,
    })
    // 333 / 2000 = 16.65% -> 17
    expect(rows[0].percent).toBe(17)
  })

  it('uses Starter fallback caps when plan is null', () => {
    const { rows } = buildMeterSet({
      counter: { messages_used: 1000, crawl_pages_used: 0, files_stored: 0 },
      caps: null,
    })
    expect(rows[0].max).toBe(2000)
    expect(rows[0].percent).toBe(50)
  })

  it('defends against zero/negative caps (divides by 1)', () => {
    const { rows } = buildMeterSet({
      counter: { messages_used: 5, crawl_pages_used: 0, files_stored: 0 },
      caps: {
        monthly_message_limit: 0,
        monthly_crawl_page_limit: 500,
        supplementary_file_limit: 25,
      },
    })
    expect(rows[0].percent).toBe(100) // 5/1 capped
  })
})
