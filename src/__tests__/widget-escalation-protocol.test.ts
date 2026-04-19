/**
 * M7F4 widget protocol + payload helpers. Pure-function coverage for
 * the \x1E trailer parser and the show_form payload builder.
 */

import { describe, it, expect } from 'vitest'
import {
  parseStream,
  buildShowFormPayload,
  PENDING_ACTION_SENTINEL,
} from '../../widget/src/escalation-protocol'

describe('parseStream', () => {
  it('returns text + null when no sentinel', () => {
    const r = parseStream('Hello there, how can I help?')
    expect(r.text).toBe('Hello there, how can I help?')
    expect(r.pendingAction).toBeNull()
  })

  it('splits on sentinel and parses trailing JSON pending_action', () => {
    const trailer = JSON.stringify({
      pending_action: {
        rule_id: 'r1',
        action: 'ask_email',
        action_config: {},
      },
    })
    const r = parseStream(`Some text${PENDING_ACTION_SENTINEL}${trailer}`)
    expect(r.text).toBe('Some text')
    expect(r.pendingAction?.action).toBe('ask_email')
    expect(r.pendingAction?.rule_id).toBe('r1')
  })

  it('returns null pending_action on malformed JSON trailer', () => {
    const r = parseStream(`visible text${PENDING_ACTION_SENTINEL}not-json{`)
    expect(r.text).toBe('visible text')
    expect(r.pendingAction).toBeNull()
  })

  it('empty trailer JSON without pending_action key yields null', () => {
    const r = parseStream(`visible${PENDING_ACTION_SENTINEL}{}`)
    expect(r.pendingAction).toBeNull()
  })

  it('handles show_form action_config.fields round-trip', () => {
    const trailer = JSON.stringify({
      pending_action: {
        rule_id: 'r2',
        action: 'show_form',
        action_config: { fields: ['name', 'phone', 'message'] },
      },
    })
    const r = parseStream(`text${PENDING_ACTION_SENTINEL}${trailer}`)
    expect(r.pendingAction?.action_config).toEqual({
      fields: ['name', 'phone', 'message'],
    })
  })
})

describe('buildShowFormPayload', () => {
  it('VAL-ESCAL-013: promotes email/phone/name to top-level AND keeps extra_fields', () => {
    const payload = buildShowFormPayload({
      name: 'Alice',
      phone: '+15550123',
      message: 'Interested in Pro',
    })
    expect(payload).toEqual({
      name: 'Alice',
      phone: '+15550123',
      extra_fields: {
        name: 'Alice',
        phone: '+15550123',
        message: 'Interested in Pro',
      },
    })
  })

  it('omits promoted key when empty string', () => {
    const payload = buildShowFormPayload({ name: '', phone: '+1 555' })
    expect(payload.name).toBeUndefined()
    expect(payload.phone).toBe('+1 555')
  })

  it('empty input yields empty extra_fields', () => {
    const payload = buildShowFormPayload({})
    expect(payload).toEqual({ extra_fields: {} })
  })
})
