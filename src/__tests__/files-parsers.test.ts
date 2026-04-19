/**
 * M5F3 parsers — pure-function tests for each format + adversarial cases.
 */

import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  decodeText,
  isEncryptedPdf,
  parseFile,
  FileParseError,
  MAX_EXTRACTED_BYTES,
} from '@/lib/files/parsers'

describe('decodeText (VAL-FILE-023)', () => {
  it('decodes valid UTF-8', () => {
    const bytes = new TextEncoder().encode('héllo, wörld')
    expect(decodeText(bytes)).toBe('héllo, wörld')
  })

  it('gracefully decodes invalid UTF-8 with replacement chars (no throw)', () => {
    // Latin-1 'café' bytes (é = 0xE9)
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9])
    const out = decodeText(bytes)
    // Invalid sequence — replacement char U+FFFD is acceptable.
    expect(out).toContain('\uFFFD')
    expect(out.startsWith('caf')).toBe(true)
  })
})

describe('isEncryptedPdf', () => {
  it('detects /Encrypt marker in first 4KB', () => {
    const header = new TextEncoder().encode(
      '%PDF-1.5\n1 0 obj\n/Encrypt 2 0 R\nendobj'
    )
    expect(isEncryptedPdf(header)).toBe(true)
  })

  it('returns false for a clean PDF head', () => {
    const header = new TextEncoder().encode(
      '%PDF-1.5\n1 0 obj\n<</Type /Catalog>>\nendobj'
    )
    expect(isEncryptedPdf(header)).toBe(false)
  })
})

describe('parseFile(txt / md / csv)', () => {
  it('VAL-FILE-008: TXT round-trips text content', async () => {
    const bytes = new TextEncoder().encode('Hello, world.\nLine two.')
    const result = await parseFile(bytes, 'txt')
    expect(result.text).toBe('Hello, world.\nLine two.')
  })

  it('VAL-FILE-009: MD round-trips markdown content', async () => {
    const bytes = new TextEncoder().encode('# Heading\n\nBody.')
    const result = await parseFile(bytes, 'md')
    expect(result.text).toBe('# Heading\n\nBody.')
  })

  it('VAL-FILE-007: CSV decodes as text', async () => {
    const bytes = new TextEncoder().encode('name,age\nAlice,30\nBob,25')
    const result = await parseFile(bytes, 'csv')
    expect(result.text).toContain('Alice,30')
    expect(result.text).toContain('Bob,25')
  })

  it('VAL-FILE-023: non-UTF8 CSV decodes with replacement chars (no throw)', async () => {
    const bytes = new Uint8Array([
      0x6e, 0x61, 0x6d, 0x65, 0x2c, 0x61, 0x67, 0x65, 0x0a, // "name,age\n"
      0x63, 0x61, 0x66, 0xe9, 0x2c, 0x33, 0x30, // "caf\xe9,30"
    ])
    const result = await parseFile(bytes, 'csv')
    expect(result.text).toContain('name,age')
    expect(result.text).toContain('30')
  })
})

describe('parseFile(pdf) adversarial', () => {
  it('VAL-FILE-020: encrypted PDF rejected with clear error', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.5\n/Encrypt 2 0 R\n')
    await expect(parseFile(bytes, 'pdf')).rejects.toThrow(FileParseError)
    await expect(parseFile(bytes, 'pdf')).rejects.toMatchObject({
      code: 'pdf_encrypted',
    })
  })

  it('VAL-FILE-003: real PDF round-trips text content', async () => {
    const pdfDoc = await PDFDocument.create()
    const page = pdfDoc.addPage([400, 600])
    page.drawText('This is supplementary knowledge content.', { x: 50, y: 500 })
    const bytes = await pdfDoc.save()
    const result = await parseFile(bytes, 'pdf')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.text).toMatch(/supplementary knowledge/i)
  })
})

describe('parseFile(xlsx)', () => {
  it('VAL-FILE-006: XLSX extracts sheet names and rows', async () => {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Name', 'Role'],
      ['Alice', 'Engineer'],
      ['Bob', 'Designer'],
    ])
    XLSX.utils.book_append_sheet(wb, sheet, 'Team')

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const bytes = new Uint8Array(buf)

    const result = await parseFile(bytes, 'xlsx')
    expect(result.sheets).toContain('Team')
    expect(result.text).toContain('## Team')
    expect(result.text).toContain('Alice,Engineer')
  })
})

describe('MAX_EXTRACTED_BYTES', () => {
  it('is 100MB', () => {
    expect(MAX_EXTRACTED_BYTES).toBe(100 * 1024 * 1024)
  })
})
