import type { Metadata } from 'next'
import Landing from './landing'

export const metadata: Metadata = {
  title: 'RubyCrawl — An AI chatbot for your website in 3 minutes',
  description:
    'Paste your URL. We crawl every page, train an AI chatbot on your content, and hand you one script tag to embed. For small businesses, not enterprises.',
}

export default function Page() {
  return <Landing />
}
