/**
 * M9F14 adversarial-file-fixtures.
 *
 * Fulfills VAL-FILE-004, VAL-FILE-005, VAL-FILE-016, VAL-FILE-017,
 * VAL-FILE-022. Exercises src/lib/files/parsers.ts with:
 *   - Real DOCX fixture    → mammoth extracts body text (004)
 *   - Real PPTX fixture    → officeparser extracts slide text (005)
 *   - Zip-bomb (DOCX)      → assertBelowCap throws docx_decompression_too_large (016)
 *   - PDF-bomb             → assertBelowCap throws pdf_decompression_too_large (017)
 *   - Macro-laden DOCX     → mammoth ignores vbaProject.bin; no macro bytes surface (022)
 *
 * For 016/017 the real mammoth / pdf-parse libraries are overridden per
 * test to return a text blob longer than MAX_EXTRACTED_BYTES. This
 * exercises the exact defensive branch in parsers.ts without committing
 * 100MB+ of memory pressure to CI. Default behavior is pass-through —
 * the 004/005/022 tests run against the real extractors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockMammoth, mockPdfParse } = vi.hoisted(() => ({
  mockMammoth: { overrideText: null as string | null },
  mockPdfParse: { overrideText: null as string | null },
}))

// mammoth ships without .d.ts so the dynamic import is implicit-any.
vi.mock('mammoth', async (importActual) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await importActual()) as any
  const realDefault = actual.default ?? actual
  return {
    default: new Proxy(realDefault, {
      get(target, prop) {
        if (prop === 'extractRawText') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return async (input: any) => {
            if (mockMammoth.overrideText !== null) {
              return { value: mockMammoth.overrideText, messages: [] }
            }
            return realDefault.extractRawText(input)
          }
        }
        return Reflect.get(target, prop)
      },
    }),
  }
})

// Lazy pass-through: only instantiate the real PDFParse when no override
// is set. Under full-suite parallel load the eager construct path was
// slow enough to trip the 5s test timeout for VAL-FILE-017.
vi.mock('pdf-parse', async (importActual) => {
  const actual = (await importActual()) as typeof import('pdf-parse')
  class PatchedPdfParse {
    private readonly opts: ConstructorParameters<typeof actual.PDFParse>[0]
    private real: InstanceType<typeof actual.PDFParse> | null = null
    constructor(opts: ConstructorParameters<typeof actual.PDFParse>[0]) {
      this.opts = opts
    }
    async getText(): Promise<{ text: string; total: number }> {
      if (mockPdfParse.overrideText !== null) {
        return { text: mockPdfParse.overrideText, total: 1 }
      }
      if (!this.real) this.real = new actual.PDFParse(this.opts)
      const r = await this.real.getText()
      return { text: r.text, total: r.total ?? 1 }
    }
    async destroy(): Promise<void> {
      if (this.real) return this.real.destroy()
    }
  }
  return { ...actual, PDFParse: PatchedPdfParse }
})

import {
  parseFile,
  FileParseError,
  MAX_EXTRACTED_BYTES,
} from '@/lib/files/parsers'
import {
  makeMinimalDocx,
  makeMinimalPptx,
  makeMacroDocx,
} from '../../e2e/fixtures/files/adversarial'

beforeEach(() => {
  mockMammoth.overrideText = null
  mockPdfParse.overrideText = null
})

describe('adversarial file fixtures (M9F14)', () => {
  it('VAL-FILE-004: real DOCX fixture parsed as plain text via mammoth', async () => {
    const docx = makeMinimalDocx(
      'This is substantive DOCX content for validation.'
    )
    const result = await parseFile(docx, 'docx')
    expect(result.text).toContain('substantive DOCX content for validation')
    expect(result.text.length).toBeGreaterThan(10)
  })

  it('VAL-FILE-005: real PPTX fixture parsed as plain text via officeparser', async () => {
    const pptx = makeMinimalPptx('Slide body text for validation')
    const result = await parseFile(pptx, 'pptx')
    expect(result.text).toContain('Slide body text for validation')
  })

  it('VAL-FILE-016: zip-bomb DOCX (extracted text > cap) rejected with docx_decompression_too_large', { timeout: 30_000 }, async () => {
    // Over-cap by 1 byte — proves the boundary is exact without forcing
    // the test runner to allocate the full cap + margin twice.
    mockMammoth.overrideText = 'x'.repeat(MAX_EXTRACTED_BYTES + 1)

    const docx = makeMinimalDocx('placeholder body (mocked extractor returns over-cap text)')
    await expect(parseFile(docx, 'docx')).rejects.toBeInstanceOf(FileParseError)
    await expect(parseFile(docx, 'docx')).rejects.toMatchObject({
      code: 'docx_decompression_too_large',
    })
  })

  it('VAL-FILE-017: PDF-bomb (decompressed text > cap) rejected with pdf_decompression_too_large', { timeout: 30_000 }, async () => {
    mockPdfParse.overrideText = 'y'.repeat(MAX_EXTRACTED_BYTES + 1)

    // Any non-encrypted PDF header bytes — the mock returns an oversized
    // text blob regardless of input, but parsePdf must first pass the
    // isEncryptedPdf() check with a clean header.
    const pdfHead = new TextEncoder().encode(
      '%PDF-1.5\n1 0 obj\n<</Type /Catalog>>\nendobj'
    )
    await expect(parseFile(pdfHead, 'pdf')).rejects.toBeInstanceOf(
      FileParseError
    )
    await expect(parseFile(pdfHead, 'pdf')).rejects.toMatchObject({
      code: 'pdf_decompression_too_large',
    })
  })

  it('VAL-FILE-022: macro-laden DOCX parsed as plain text; no macro bytes surface', async () => {
    const docx = makeMacroDocx('Body text from macro-carrying doc.')
    const result = await parseFile(docx, 'docx')

    // Body text is present.
    expect(result.text).toContain('Body text from macro-carrying doc')
    // None of the vbaProject.bin magic bytes bleed into extracted text:
    // NULLs, 'VBAProject' signature, or PE 'MZ' header.
    expect(result.text.includes('\u0000')).toBe(false)
    expect(result.text).not.toMatch(/VBAProject/)
    expect(result.text).not.toMatch(/\bMZ\b/)
  })
})
