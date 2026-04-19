import { describe, it, expect } from 'vitest'
import {
  ALLOWED_EXTENSIONS,
  inferExtension,
  verifyMagicBytes,
  sanitizeFilename,
  sanitizeTraversalFilename,
  MAX_FILE_BYTES,
} from '@/lib/files/validate'

describe('MAX_FILE_BYTES', () => {
  it('is 25MB', () => {
    expect(MAX_FILE_BYTES).toBe(25 * 1024 * 1024)
  })
})

describe('inferExtension', () => {
  it.each(ALLOWED_EXTENSIONS)('accepts %s', (ext) => {
    expect(inferExtension(`file.${ext}`)).toBe(ext)
  })

  it('rejects exe', () => {
    expect(inferExtension('malware.exe')).toBeNull()
  })

  it('rejects zip', () => {
    expect(inferExtension('bomb.zip')).toBeNull()
  })

  it('rejects file with no extension', () => {
    expect(inferExtension('README')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(inferExtension('Report.PDF')).toBe('pdf')
  })

  it('uses last extension when chained', () => {
    // 'doc.pdf.exe' -> 'exe' -> rejected (magic-byte also catches)
    expect(inferExtension('doc.pdf.exe')).toBeNull()
  })
})

describe('verifyMagicBytes', () => {
  it('accepts real PDF signature', () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])
    expect(verifyMagicBytes(buf, 'pdf')).toBe(true)
  })

  it('rejects fake PDF (text with .pdf extension)', () => {
    const buf = new TextEncoder().encode('Hello world')
    expect(verifyMagicBytes(buf, 'pdf')).toBe(false)
  })

  it('accepts ZIP magic for docx/pptx/xlsx', () => {
    const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(verifyMagicBytes(buf, 'docx')).toBe(true)
    expect(verifyMagicBytes(buf, 'pptx')).toBe(true)
    expect(verifyMagicBytes(buf, 'xlsx')).toBe(true)
  })

  it('rejects ZIP with wrong extension', () => {
    const buf = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(verifyMagicBytes(buf, 'pdf')).toBe(false)
  })

  it('accepts plain text for txt/md/csv', () => {
    const buf = new TextEncoder().encode('hello,world\n1,2\n3,4\n')
    expect(verifyMagicBytes(buf, 'csv')).toBe(true)
    expect(verifyMagicBytes(buf, 'txt')).toBe(true)
    expect(verifyMagicBytes(buf, 'md')).toBe(true)
  })

  it('rejects binary-looking buffer for txt (NUL byte in first 4KB)', () => {
    const buf = new Uint8Array([72, 101, 108, 108, 0, 111])
    expect(verifyMagicBytes(buf, 'txt')).toBe(false)
  })

  it('VAL-FILE-018: .exe signature with pdf extension fails magic-byte', () => {
    // Windows PE header MZ
    const buf = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])
    expect(verifyMagicBytes(buf, 'pdf')).toBe(false)
  })
})

describe('sanitizeFilename', () => {
  it('strips forward slashes', () => {
    expect(sanitizeFilename('/etc/passwd.pdf')).toBe('passwd.pdf')
  })

  it('strips backslashes', () => {
    expect(sanitizeFilename('C:\\Users\\me\\doc.docx')).toBe('doc.docx')
  })

  it('strips leading dots (hidden files)', () => {
    expect(sanitizeFilename('.env')).toBe('env')
  })

  it('clamps to 255 chars', () => {
    const long = 'a'.repeat(300) + '.pdf'
    expect(sanitizeFilename(long)).toHaveLength(255)
  })

  it('replaces suspicious chars with _', () => {
    expect(sanitizeFilename('my<script>doc.pdf')).toBe('my_script_doc.pdf')
  })

  it('returns "file" on empty input', () => {
    expect(sanitizeFilename('')).toBe('file')
  })

  it('preserves dashes, underscores, dots, parens, brackets, spaces', () => {
    expect(sanitizeFilename('Q3 Report (2025) [final].pdf')).toBe(
      'Q3 Report (2025) [final].pdf'
    )
  })
})

describe('sanitizeTraversalFilename (VAL-FILE-019)', () => {
  it('../../etc/passwd.pdf -> etc_passwd.pdf', () => {
    expect(sanitizeTraversalFilename('../../etc/passwd.pdf')).toBe(
      'etc_passwd.pdf'
    )
  })

  it('./doc.pdf -> doc.pdf', () => {
    expect(sanitizeTraversalFilename('./doc.pdf')).toBe('doc.pdf')
  })

  it('/absolute/path/doc.pdf -> absolute_path_doc.pdf', () => {
    expect(sanitizeTraversalFilename('/absolute/path/doc.pdf')).toBe(
      'absolute_path_doc.pdf'
    )
  })

  it('plain filename unchanged', () => {
    expect(sanitizeTraversalFilename('report.pdf')).toBe('report.pdf')
  })
})
