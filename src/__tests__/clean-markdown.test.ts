import { describe, it, expect } from 'vitest'
import { cleanMarkdown } from '@/lib/crawl/clean'

describe('cleanMarkdown', () => {
  it('returns empty string for null/undefined/empty input', () => {
    expect(cleanMarkdown('')).toBe('')
    expect(cleanMarkdown(null as unknown as string)).toBe('')
    expect(cleanMarkdown(undefined as unknown as string)).toBe('')
  })

  it('preserves normal content', () => {
    const content = '# Hello World\n\nThis is a paragraph about our services.'
    expect(cleanMarkdown(content)).toBe(content)
  })

  it('removes HTML comments', () => {
    const input = '# Title\n\n<!-- This is a comment -->\n\nContent here'
    const result = cleanMarkdown(input)
    expect(result).not.toContain('<!--')
    expect(result).toContain('# Title')
    expect(result).toContain('Content here')
  })

  it('removes breadcrumb patterns', () => {
    const input = '# Page\n\nHome > Products > Category > Item\n\nActual content'
    const result = cleanMarkdown(input)
    expect(result).not.toContain('Home > Products')
    expect(result).toContain('Actual content')
  })

  it('removes markdown link breadcrumbs', () => {
    const input =
      '# Page\n\n[Home](/) > [Products](/products) > Item\n\nContent'
    const result = cleanMarkdown(input)
    expect(result).not.toContain('[Home]')
    expect(result).toContain('Content')
  })

  it('removes feedback widgets', () => {
    const input =
      '# Help\n\nSome helpful info.\n\nWas this page helpful?\nYes No\n\nMore content'
    const result = cleanMarkdown(input)
    expect(result).not.toContain('Was this page helpful')
    expect(result).toContain('Some helpful info.')
  })

  it('removes copyright/footer lines', () => {
    const input = '# Content\n\nGood stuff here.\n\n© 2024 Company Inc. All rights reserved.'
    const result = cleanMarkdown(input)
    expect(result).not.toContain('©')
    expect(result).toContain('Good stuff here.')
  })

  it('removes "Last updated" lines', () => {
    const input = '# Doc\n\nContent\n\nLast updated: January 15, 2024'
    const result = cleanMarkdown(input)
    expect(result).not.toContain('Last updated')
    expect(result).toContain('Content')
  })

  it('removes "Skip to content" lines', () => {
    const input = 'Skip to content\n\n# Page Title\n\nContent here'
    const result = cleanMarkdown(input)
    expect(result).not.toContain('Skip to content')
    expect(result).toContain('# Page Title')
  })

  it('collapses excessive blank lines', () => {
    const input = '# Title\n\n\n\n\n\nContent\n\n\n\n\nMore content'
    const result = cleanMarkdown(input)
    // Should have at most two consecutive newlines
    expect(result).not.toMatch(/\n{3,}/)
    expect(result).toContain('# Title')
    expect(result).toContain('Content')
    expect(result).toContain('More content')
  })

  it('trims leading and trailing whitespace', () => {
    const input = '   \n\n# Title\n\nContent\n\n   '
    const result = cleanMarkdown(input)
    expect(result).toBe('# Title\n\nContent')
  })

  it('removes standalone separator lines', () => {
    const input = '# Title\n\n---\n\nContent\n\n===\n\nMore'
    const result = cleanMarkdown(input)
    expect(result).not.toMatch(/^[-=]{3,}$/m)
  })

  it('handles realistic Firecrawl output', () => {
    const input = `Skip to content

[Home](/) > [Blog](/blog) > My Article

# My Article

This is the article content with important information about our services.

We offer great value to customers.

## Pricing

Our plans start at $24.99/month.

Was this page helpful?
Yes No

Last updated: March 2024

© 2024 My Company. All rights reserved.`

    const result = cleanMarkdown(input)
    expect(result).toContain('# My Article')
    expect(result).toContain('article content')
    expect(result).toContain('## Pricing')
    expect(result).toContain('$24.99/month')
    expect(result).not.toContain('Skip to content')
    expect(result).not.toContain('[Home]')
    expect(result).not.toContain('Was this page helpful')
    expect(result).not.toContain('Last updated')
    expect(result).not.toContain('©')
  })
})
