import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'

describe('buildSystemPrompt with file-sourced chunks (VAL-FILE-024)', () => {
  it('renders file citations as (File: <name>) instead of (Source: <url>)', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: [
        {
          chunk_text: 'Our hours are 9 to 5.',
          source_url: 'file://hours.pdf',
          source_type: 'file',
        },
        {
          chunk_text: 'Contact us at hello@acme.test.',
          source_url: 'https://acme.test/contact',
          source_type: 'crawl',
        },
      ],
    })

    expect(prompt).toContain('[1] (File: hours.pdf)')
    expect(prompt).toContain('[2] (Source: https://acme.test/contact)')
  })

  it('recognises file:// URLs even without source_type (legacy compatibility)', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: [
        {
          chunk_text: 'Pricing info.',
          source_url: 'file://pricing.pdf',
        },
      ],
    })
    expect(prompt).toContain('[1] (File: pricing.pdf)')
  })

  it('keeps crawl-sourced chunks untouched (unchanged format)', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: [
        {
          chunk_text: 'About us.',
          source_url: 'https://acme.test/about',
        },
      ],
    })
    expect(prompt).toContain('[1] (Source: https://acme.test/about)')
  })
})
