/**
 * File parsers. Pure helpers — no DB, no Storage. Given raw bytes + a
 * known-good extension (already validated by src/lib/files/validate.ts),
 * extract plain text + enforce decompression caps to defend against
 * zip/PDF bombs.
 */

import type { AllowedExt } from './validate'

/**
 * Decompressed-output cap. PDFs and Office documents can legitimately
 * expand 10-50x over their compressed size, but >100MB of extracted text
 * is unreasonable for knowledge-base uploads — almost always a bomb or a
 * misfiled corpus dump.
 */
export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024

export class FileParseError extends Error {
  constructor(public code: string, message: string) {
    super(message)
    this.name = 'FileParseError'
  }
}

export interface ParseResult {
  text: string
  pages?: number
  sheets?: string[]
}

/** Cheap heuristic: look for `/Encrypt` in the first 4KB of the PDF. */
export function isEncryptedPdf(bytes: Uint8Array): boolean {
  const sliceEnd = Math.min(4096, bytes.length)
  const head = bytes.subarray(0, sliceEnd)
  // Convert to a latin1 string for indexOf — safe for ASCII marker lookup.
  let asBinary = ''
  for (let i = 0; i < head.length; i++) asBinary += String.fromCharCode(head[i]!)
  return asBinary.includes('/Encrypt')
}

/**
 * Decode bytes as text, tolerating non-UTF8 input gracefully (VAL-FILE-023).
 * Strict pass first — falls back to replacement-character decoding on
 * invalid sequences rather than throwing.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  }
}

function assertBelowCap(text: string, fmt: string): void {
  if (text.length > MAX_EXTRACTED_BYTES) {
    throw new FileParseError(
      `${fmt}_decompression_too_large`,
      `Extracted text exceeds ${MAX_EXTRACTED_BYTES} byte cap — possible bomb.`
    )
  }
}

async function parsePdf(bytes: Uint8Array): Promise<ParseResult> {
  if (isEncryptedPdf(bytes)) {
    throw new FileParseError(
      'pdf_encrypted',
      'This PDF is password-protected. Remove the password and re-upload.'
    )
  }
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: bytes })
  try {
    const result = await parser.getText()
    assertBelowCap(result.text, 'pdf')
    return { text: result.text, pages: result.total }
  } finally {
    await parser.destroy()
  }
}

async function parseDocx(bytes: Uint8Array): Promise<ParseResult> {
  const mammoth = await import('mammoth')
  // extractRawText strips formatting, including any VBA macro artifacts —
  // mammoth's core parser ignores the /word/vbaProject.bin binary part
  // entirely, so macros are never surfaced as text (VAL-FILE-022).
  const result = await mammoth.default.extractRawText({
    buffer: Buffer.from(bytes),
  })
  assertBelowCap(result.value, 'docx')
  return { text: result.value }
}

async function parsePptx(bytes: Uint8Array): Promise<ParseResult> {
  // officeparser v5 accepts ArrayBuffer/Buffer directly via parseOfficeAsync.
  const { parseOfficeAsync } = await import('officeparser')
  const text = await parseOfficeAsync(Buffer.from(bytes))
  assertBelowCap(text, 'pptx')
  return { text }
}

async function parseXlsx(bytes: Uint8Array): Promise<ParseResult> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(bytes, { type: 'array' })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    parts.push(`## ${name}`)
    const sheet = wb.Sheets[name]
    if (sheet) {
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
      parts.push(csv)
    }
  }
  const text = parts.join('\n\n')
  assertBelowCap(text, 'xlsx')
  return { text, sheets: wb.SheetNames }
}

function parseCsv(bytes: Uint8Array): ParseResult {
  const text = decodeText(bytes)
  assertBelowCap(text, 'csv')
  return { text }
}

function parseTxtOrMd(bytes: Uint8Array): ParseResult {
  const text = decodeText(bytes)
  assertBelowCap(text, 'text')
  return { text }
}

/**
 * Entry point. Route the raw bytes to the right parser given the
 * already-validated extension. Throws FileParseError on a format-specific
 * failure; the caller records error_message.
 */
export async function parseFile(
  bytes: Uint8Array,
  ext: AllowedExt
): Promise<ParseResult> {
  switch (ext) {
    case 'pdf':
      return parsePdf(bytes)
    case 'docx':
      return parseDocx(bytes)
    case 'pptx':
      return parsePptx(bytes)
    case 'xlsx':
      return parseXlsx(bytes)
    case 'csv':
      return parseCsv(bytes)
    case 'txt':
    case 'md':
      return parseTxtOrMd(bytes)
  }
}
