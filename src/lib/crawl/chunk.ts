/**
 * Two-layer chunking strategy:
 * 1. Split by headers (h1-h4) to preserve topical sections
 * 2. If a section exceeds ~512 tokens, apply RecursiveCharacterTextSplitter
 *
 * Approximation: 1 token ≈ 4 characters (standard for English text)
 */

const TOKENS_PER_CHUNK = 512
const CHARS_PER_TOKEN = 4
const MAX_CHARS = TOKENS_PER_CHUNK * CHARS_PER_TOKEN // 2048

// Overlap in characters for recursive splitting
const OVERLAP_CHARS = 200

export interface Chunk {
  text: string
  headingContext: string
}

/**
 * Split markdown into chunks using a two-layer strategy:
 * 1. Split by markdown headers to preserve topical sections
 * 2. Recursively split large sections to fit within ~512 tokens
 */
export function chunkMarkdown(markdown: string): Chunk[] {
  if (!markdown || typeof markdown !== 'string') return []

  const trimmed = markdown.trim()
  if (trimmed.length === 0) return []

  // Step 1: Split by headers
  const sections = splitByHeaders(trimmed)

  // Step 2: For each section, recursively split if too large
  const chunks: Chunk[] = []
  for (const section of sections) {
    if (section.text.length <= MAX_CHARS) {
      // Section fits within one chunk
      if (section.text.trim().length > 0) {
        chunks.push({
          text: section.text.trim(),
          headingContext: section.heading,
        })
      }
    } else {
      // Section is too large — recursively split
      const subChunks = recursiveSplit(section.text, MAX_CHARS, OVERLAP_CHARS)
      for (const sub of subChunks) {
        if (sub.trim().length > 0) {
          chunks.push({
            text: sub.trim(),
            headingContext: section.heading,
          })
        }
      }
    }
  }

  return chunks
}

interface Section {
  heading: string
  text: string
}

/**
 * Split markdown text by headers (h1-h4), preserving the header
 * as part of its section's text and as the heading context.
 */
function splitByHeaders(text: string): Section[] {
  // Match markdown headers (# to ####)
  const headerRegex = /^(#{1,4})\s+(.+)$/gm
  const sections: Section[] = []

  let lastIndex = 0
  let currentHeading = ''
  let match: RegExpExecArray | null

  while ((match = headerRegex.exec(text)) !== null) {
    // Capture text before this header (if any)
    const beforeText = text.slice(lastIndex, match.index)
    if (beforeText.trim().length > 0) {
      sections.push({
        heading: currentHeading,
        text: beforeText.trim(),
      })
    }

    currentHeading = match[2].trim()
    lastIndex = match.index
  }

  // Capture remaining text after last header
  const remainingText = text.slice(lastIndex)
  if (remainingText.trim().length > 0) {
    sections.push({
      heading: currentHeading,
      text: remainingText.trim(),
    })
  }

  // If no headers found, return the whole text as one section
  if (sections.length === 0 && text.trim().length > 0) {
    sections.push({ heading: '', text: text.trim() })
  }

  return sections
}

/**
 * Recursively split text into chunks of at most maxChars characters.
 * Uses paragraph breaks, then sentence breaks, then word breaks as separators.
 */
function recursiveSplit(
  text: string,
  maxChars: number,
  overlap: number
): string[] {
  if (text.length <= maxChars) return [text]

  const separators = ['\n\n', '\n', '. ', ' ']
  return splitWithSeparators(text, separators, maxChars, overlap)
}

function splitWithSeparators(
  text: string,
  separators: string[],
  maxChars: number,
  overlap: number
): string[] {
  if (text.length <= maxChars) return [text]
  if (separators.length === 0) {
    // Last resort: hard split at maxChars
    return hardSplit(text, maxChars, overlap)
  }

  const separator = separators[0]
  const parts = text.split(separator)

  if (parts.length <= 1) {
    // Separator not found, try next one
    return splitWithSeparators(text, separators.slice(1), maxChars, overlap)
  }

  const chunks: string[] = []
  let currentChunk = ''

  for (const part of parts) {
    const candidate = currentChunk
      ? currentChunk + separator + part
      : part

    if (candidate.length <= maxChars) {
      currentChunk = candidate
    } else {
      // Save current chunk
      if (currentChunk.length > 0) {
        chunks.push(currentChunk)
      }

      // If part itself is too large, recursively split it
      if (part.length > maxChars) {
        const subChunks = splitWithSeparators(
          part,
          separators.slice(1),
          maxChars,
          overlap
        )
        chunks.push(...subChunks)
        currentChunk = ''
      } else {
        // Start new chunk with overlap from previous chunk
        const overlapText = getOverlapText(currentChunk, overlap)
        currentChunk = overlapText ? overlapText + separator + part : part
        // If overlap makes it too large, just use the part
        if (currentChunk.length > maxChars) {
          currentChunk = part
        }
      }
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
}

/**
 * Get the last `overlap` characters from text, broken at a word boundary.
 */
function getOverlapText(text: string, overlap: number): string {
  if (!text || overlap <= 0) return ''

  const tail = text.slice(-overlap)
  // Find the first space to get a clean word boundary
  const spaceIdx = tail.indexOf(' ')
  if (spaceIdx === -1) return tail
  return tail.slice(spaceIdx + 1)
}

/**
 * Hard split at maxChars, used as last resort.
 */
function hardSplit(
  text: string,
  maxChars: number,
  overlap: number
): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length)
    chunks.push(text.slice(start, end))
    start = end - overlap
    if (start >= text.length) break
    // Prevent infinite loop
    if (start <= chunks.length * overlap - overlap) break
  }

  return chunks
}
