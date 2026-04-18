import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'RubyCrawl — AI chatbot for your website',
  description:
    'Paste your URL. We crawl it and give you an AI chatbot that knows your business. 24/7, trained on your content.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster
          position="top-right"
          theme="light"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast:
                'border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] text-[color:var(--ink-primary)]',
              description: 'text-[color:var(--ink-secondary)]',
            },
          }}
        />
      </body>
    </html>
  )
}
