import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '@/lib/chat/system-prompt'

const baseChunks = [
  { chunk_text: 'We offer plumbing repair.', source_url: 'https://example.com/services' },
  { chunk_text: 'Open 9-5 Mon-Fri.', source_url: 'https://example.com/hours' },
]

describe('buildSystemPrompt', () => {
  it('includes site name and url', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme Plumbing',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt).toContain('Acme Plumbing')
    expect(prompt).toContain('https://acme.test')
  })

  it('numbers chunks [1], [2]', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt).toContain('[1]')
    expect(prompt).toContain('[2]')
    expect(prompt).toContain('We offer plumbing repair.')
    expect(prompt).toContain('Open 9-5 Mon-Fri.')
  })

  it('includes Calendly instruction when url provided', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: 'https://calendly.com/acme',
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt).toContain('https://calendly.com/acme')
    expect(prompt.toLowerCase()).toContain('book')
  })

  it('omits Calendly instruction when url is null', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt).not.toContain('calendly')
  })

  it('includes Google Maps instruction when url provided', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: 'https://maps.google.com/acme',
      chunks: baseChunks,
    })
    expect(prompt).toContain('https://maps.google.com/acme')
    expect(prompt.toLowerCase()).toContain('direction')
  })

  it('omits Maps instruction when url is null', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt.toLowerCase()).not.toContain('directions')
  })

  it('includes fallback instruction', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt).toContain("I don't have that information")
  })

  it('includes citation instruction', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt).toMatch(/cite.*\[1\]/i)
  })

  it('delimits instructions from retrieved context', () => {
    const prompt = buildSystemPrompt({
      siteName: 'Acme',
      siteUrl: 'https://acme.test',
      calendlyUrl: null,
      googleMapsUrl: null,
      chunks: baseChunks,
    })
    expect(prompt).toContain('[SYSTEM INSTRUCTIONS')
    expect(prompt).toContain('[END SYSTEM INSTRUCTIONS]')
    expect(prompt).toContain('[RETRIEVED CONTEXT')
    expect(prompt).toContain('[END RETRIEVED CONTEXT]')
  })
})
