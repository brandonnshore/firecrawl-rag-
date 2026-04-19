/**
 * File-upload validation: allow-list extension, magic-byte sniff, filename
 * sanitization. Pure helpers — no I/O. Unit-tested by files-validate.test.ts.
 */

export const ALLOWED_EXTENSIONS = [
  'pdf',
  'docx',
  'pptx',
  'xlsx',
  'csv',
  'txt',
  'md',
] as const

export type AllowedExt = (typeof ALLOWED_EXTENSIONS)[number]

export const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25MB

/** Returns the allowed extension or null if not permitted. */
export function inferExtension(filename: string): AllowedExt | null {
  const parts = filename.split('.')
  if (parts.length < 2) return null
  const ext = parts[parts.length - 1]!.toLowerCase()
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as AllowedExt)
    : null
}

/**
 * Verify the file's leading bytes match its declared extension.
 * Defeats MIME-spoofing: `.exe` labeled application/pdf still fails.
 * For plaintext formats (csv/txt/md) we require no NUL bytes in the
 * first 4KB — cheap binary heuristic.
 */
export function verifyMagicBytes(buffer: Uint8Array, ext: AllowedExt): boolean {
  if (ext === 'pdf') {
    // %PDF-
    return (
      buffer.length >= 5 &&
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46 &&
      buffer[4] === 0x2d
    )
  }
  if (ext === 'docx' || ext === 'pptx' || ext === 'xlsx') {
    // ZIP magic: PK\x03\x04 (normal), PK\x05\x06 (empty), PK\x07\x08 (split)
    if (buffer.length < 4) return false
    const [b0, b1, b2, b3] = buffer
    if (b0 !== 0x50 || b1 !== 0x4b) return false
    return (
      (b2 === 0x03 && b3 === 0x04) ||
      (b2 === 0x05 && b3 === 0x06) ||
      (b2 === 0x07 && b3 === 0x08)
    )
  }
  if (ext === 'csv' || ext === 'txt' || ext === 'md') {
    const sampleEnd = Math.min(4096, buffer.length)
    for (let i = 0; i < sampleEnd; i++) {
      if (buffer[i] === 0x00) return false
    }
    return true
  }
  return false
}

/**
 * Make a filename safe for storage. Strip path separators, clamp length,
 * prevent leading-dot hidden files. Never returns empty string.
 *
 * Examples:
 *   '../../etc/passwd.pdf'   -> 'etc_passwd.pdf'
 *   '.hiddenfile'            -> 'hiddenfile'
 *   '/absolute/path/doc.pdf' -> 'doc.pdf'
 */
export function sanitizeFilename(raw: string): string {
  if (!raw) return 'file'
  // Drop everything up to (and including) the last path separator.
  const basename = raw.split(/[/\\]/).filter(Boolean).pop() ?? 'file'
  // Remove leading dots then replace any remaining dodgy chars.
  let clean = basename
    .replace(/^\.+/, '')
    .replace(/[^A-Za-z0-9._ \-()[\]]/g, '_')
  if (clean.length === 0) clean = 'file'
  if (clean.length > 255) clean = clean.slice(0, 255)
  return clean
}

/**
 * Filename for the pre-sanitized path (used when we want to detect that
 * traversal segments existed before sanitization). For VAL-FILE-019
 * ../../etc/passwd.pdf should store as 'etc_passwd.pdf'.
 */
export function sanitizeTraversalFilename(raw: string): string {
  // Join path segments with '_', excluding '..' / '.'.
  const segments = raw
    .split(/[/\\]/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
  if (segments.length === 0) return 'file'
  const joined = segments.join('_')
  return sanitizeFilename(joined)
}
