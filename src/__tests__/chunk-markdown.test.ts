import { describe, it, expect } from 'vitest'
import { chunkMarkdown } from '@/lib/crawl/chunk'

describe('chunkMarkdown', () => {
  it('returns empty array for empty/null/undefined input', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown(null as unknown as string)).toEqual([])
    expect(chunkMarkdown(undefined as unknown as string)).toEqual([])
  })

  it('returns single chunk for short content', () => {
    const input = '# Hello\n\nThis is short content.'
    const chunks = chunkMarkdown(input)
    expect(chunks.length).toBe(1)
    expect(chunks[0].text).toContain('# Hello')
    expect(chunks[0].text).toContain('short content')
    expect(chunks[0].headingContext).toBe('Hello')
  })

  it('splits by headers into separate chunks', () => {
    const input = `# Introduction

This is the intro section with enough content.

## Features

Here are the features we offer.

## Pricing

Our plans start at $24.99/month.`

    const chunks = chunkMarkdown(input)
    expect(chunks.length).toBe(3)

    expect(chunks[0].headingContext).toBe('Introduction')
    expect(chunks[0].text).toContain('intro section')

    expect(chunks[1].headingContext).toBe('Features')
    expect(chunks[1].text).toContain('features we offer')

    expect(chunks[2].headingContext).toBe('Pricing')
    expect(chunks[2].text).toContain('$24.99')
  })

  it('handles content before any header', () => {
    const input = `Some preamble content without a header.

# First Section

Section content here.`

    const chunks = chunkMarkdown(input)
    expect(chunks.length).toBe(2)
    expect(chunks[0].headingContext).toBe('')
    expect(chunks[0].text).toContain('preamble')
  })

  it('recursively splits large sections', () => {
    // Create content larger than 2048 chars (~512 tokens)
    const paragraph = 'This is a paragraph with enough words to take up some space. '
    const largeParagraph = paragraph.repeat(60) // ~3600 chars
    const input = `# Large Section\n\n${largeParagraph}`

    const chunks = chunkMarkdown(input)
    expect(chunks.length).toBeGreaterThan(1)

    // All chunks should have the same heading context
    for (const chunk of chunks) {
      expect(chunk.headingContext).toBe('Large Section')
    }

    // All chunks should be within the max size (with some tolerance for overlap)
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(2048 + 200) // maxChars + overlap
    }
  })

  it('handles content with no headers', () => {
    const input = 'Just some plain text without any headers.'
    const chunks = chunkMarkdown(input)
    expect(chunks.length).toBe(1)
    expect(chunks[0].text).toBe('Just some plain text without any headers.')
    expect(chunks[0].headingContext).toBe('')
  })

  it('handles headers up to h4', () => {
    const input = `# H1

Content for H1.

## H2

Content for H2.

### H3

Content for H3.

#### H4

Content for H4.`

    const chunks = chunkMarkdown(input)
    expect(chunks.length).toBe(4)
    expect(chunks[0].headingContext).toBe('H1')
    expect(chunks[1].headingContext).toBe('H2')
    expect(chunks[2].headingContext).toBe('H3')
    expect(chunks[3].headingContext).toBe('H4')
  })

  it('preserves heading in chunk text', () => {
    const input = `# About Us

We are a great company.

## Our Team

We have an amazing team.`

    const chunks = chunkMarkdown(input)
    // The heading should be part of the chunk text
    expect(chunks[0].text).toContain('# About Us')
    expect(chunks[1].text).toContain('## Our Team')
  })

  it('filters out empty chunks', () => {
    const input = `# Title

## Subtitle

Content here.`

    const chunks = chunkMarkdown(input)
    // Should not have empty chunks
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0)
    }
  })

  it('handles only whitespace content', () => {
    const input = '   \n\n   \n\n   '
    expect(chunkMarkdown(input)).toEqual([])
  })
})
