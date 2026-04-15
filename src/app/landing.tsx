'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SmoothScroll } from '@/components/smooth-scroll'
import {
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconSparkle,
} from '@/components/icons'

/* --------------------------------------------------------------------------
   Landing — scroll movie.  One pinned scene ("3 minutes" promise) plus a
   sequence of scroll-triggered flow sections.  Cleanup is manual (no
   gsap.context) — we track our ScrollTriggers and kill them on unmount.
   -------------------------------------------------------------------------- */

export default function Landing() {
  return (
    <div className="relative bg-[color:var(--bg-canvas)] text-[color:var(--ink-primary)]">
      <SmoothScroll />
      <Nav />
      <Hero />
      <PinnedPromise />
      <ChatDemo />
      <EmbedScene />
      <DashboardTeaser />
      <Pricing />
      <Footer />
    </div>
  )
}

/* --------------------------------------------------------------------------
   Nav
   -------------------------------------------------------------------------- */

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-[15px] font-semibold tracking-tight">
          RubyCrawl
        </Link>
        <Link
          href="/login"
          className="btn-press focus-ring text-sm font-medium text-[color:var(--ink-secondary)] hover:text-[color:var(--ink-primary)]"
        >
          Sign in
        </Link>
      </div>
    </header>
  )
}

/* --------------------------------------------------------------------------
   Hero — typographic, character-stagger on headline
   -------------------------------------------------------------------------- */

function Hero() {
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const chars = root.querySelectorAll<HTMLElement>('[data-hero-char]')
    const tweens: gsap.core.Tween[] = []

    if (chars.length) {
      gsap.set(chars, { yPercent: 110, opacity: 0 })
      tweens.push(
        gsap.to(chars, {
          yPercent: 0,
          opacity: 1,
          duration: 0.9,
          ease: 'expo.out',
          stagger: 0.012,
          delay: 0.1,
        })
      )
    }

    const eyebrow = root.querySelector('[data-hero-eyebrow]')
    const sub = root.querySelector('[data-hero-sub]')
    const cta = root.querySelector('[data-hero-cta]')
    const meta = root.querySelector('[data-hero-meta]')

    if (eyebrow)
      tweens.push(
        gsap.from(eyebrow, { y: 12, opacity: 0, duration: 0.7, ease: 'power3.out' })
      )
    if (sub)
      tweens.push(
        gsap.from(sub, {
          y: 14,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
          delay: 0.6,
        })
      )
    if (cta)
      tweens.push(
        gsap.from(cta, {
          y: 14,
          opacity: 0,
          duration: 0.8,
          ease: 'power3.out',
          delay: 0.75,
        })
      )
    if (meta)
      tweens.push(
        gsap.from(meta, {
          opacity: 0,
          duration: 1,
          ease: 'power2.out',
          delay: 0.9,
        })
      )

    return () => {
      tweens.forEach((t) => t.kill())
    }
  }, [])

  return (
    <section
      ref={rootRef}
      className="relative flex min-h-[100dvh] flex-col justify-center px-6 pb-24 pt-32"
    >
      <div className="mx-auto w-full max-w-6xl">
        <p
          data-hero-eyebrow
          className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]"
        >
          RubyCrawl — chatbot for your website
        </p>

        <h1 className="mt-8 text-[clamp(2.75rem,8vw,7rem)] font-semibold leading-[0.92] tracking-[-0.04em]">
          <HeroLine line="An AI chatbot" />
          <br />
          <HeroLine line="for your website" muted />
          <br />
          <span className="inline-flex items-baseline gap-[0.18em] overflow-hidden align-bottom">
            <HeroWord word="in" />
            <HeroBigThree />
            <HeroWord word="minutes." />
          </span>
        </h1>

        <p
          data-hero-sub
          className="mt-10 max-w-xl text-[clamp(1rem,1.25vw,1.125rem)] leading-relaxed text-[color:var(--ink-secondary)]"
        >
          Paste your URL. We crawl every page, train a chatbot on your content,
          and hand you one script tag to embed. Built for small businesses —
          not enterprises with six figures for a custom build.
        </p>

        <div data-hero-cta className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="btn-press focus-ring group inline-flex items-center gap-2 rounded-full bg-[color:var(--ink-primary)] px-5 py-3 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"
          >
            <span>Start free trial</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10">
              <IconArrowRight
                width={13}
                height={13}
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              />
            </span>
          </Link>
          <Link
            href="#how-it-works"
            className="btn-press focus-ring inline-flex items-center gap-2 rounded-full border border-[color:var(--border-hairline)] bg-[color:var(--bg-surface)] px-5 py-3 text-sm font-medium text-[color:var(--ink-primary)] hover:border-[color:var(--border-strong)]"
          >
            See it work
          </Link>
        </div>
        <p
          data-hero-meta
          className="mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]"
        >
          7-day trial · No credit card · Cancel anytime
        </p>
      </div>
    </section>
  )
}

function HeroLine({ line, muted = false }: { line: string; muted?: boolean }) {
  return (
    <span
      className={`inline-block overflow-hidden align-bottom ${muted ? 'text-[color:var(--ink-secondary)]' : ''}`}
    >
      {line.split('').map((ch, i) => (
        <span
          key={i}
          data-hero-char
          className="inline-block will-change-transform"
          style={{ whiteSpace: ch === ' ' ? 'pre' : 'normal' }}
        >
          {ch}
        </span>
      ))}
    </span>
  )
}

/** Inline word (character-staggered) — used for "in" and "minutes." */
function HeroWord({ word }: { word: string }) {
  return (
    <span className="inline-flex overflow-hidden">
      {word.split('').map((ch, i) => (
        <span
          key={i}
          data-hero-char
          className="inline-block will-change-transform"
        >
          {ch}
        </span>
      ))}
    </span>
  )
}

/**
 * The "3" — oversized, ruby, the visual hook of the hero.  Rendered in a
 * tabular-figures slot so baseline alignment with the surrounding text stays
 * stable while the digit sits ~1.35× the headline size.
 */
function HeroBigThree() {
  return (
    <span
      data-hero-char
      aria-hidden="false"
      className="inline-flex overflow-hidden font-semibold leading-[0.82] will-change-transform"
      style={{
        color: 'var(--accent-ruby)',
        fontSize: '1.35em',
        letterSpacing: '-0.06em',
        fontVariantNumeric: 'lining-nums tabular-nums',
      }}
    >
      3
    </span>
  )
}

/* --------------------------------------------------------------------------
   Pinned promise — scroll scrubs a 3-phase timeline
   -------------------------------------------------------------------------- */

const DEMO_URL = 'https://yourbusiness.com'
const CRAWL_PAGES = [
  { path: '/', title: 'Home' },
  { path: '/about', title: 'About' },
  { path: '/services', title: 'Services' },
  { path: '/pricing', title: 'Pricing' },
  { path: '/blog/welcome', title: 'Welcome to the blog' },
  { path: '/contact', title: 'Contact' },
  { path: '/blog/launch', title: 'We just launched' },
  { path: '/team', title: 'Team' },
]

function PinnedPromise() {
  const rootRef = useRef<HTMLElement>(null)
  const [pagesVisible, setPagesVisible] = useState(0)
  const [readyVisible, setReadyVisible] = useState(false)
  const [typedUrl, setTypedUrl] = useState('')

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    if (reducedMotion) {
      /* eslint-disable react-hooks/set-state-in-effect --
         One-shot sync with prefers-reduced-motion; no animation loop. */
      setTypedUrl(DEMO_URL)
      setPagesVisible(CRAWL_PAGES.length)
      setReadyVisible(true)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }

    gsap.registerPlugin(ScrollTrigger)

    let typedSoFar = 0
    let pagesSoFar = 0

    const st = ScrollTrigger.create({
      trigger: root,
      start: 'top top',
      end: '+=1500',
      pin: true,
      scrub: 0.4,
      onUpdate: (self) => {
        const p = self.progress

        // Phase 1 (0 — 0.18): type URL (quick)
        const typeP = Math.min(1, p / 0.18)
        const chars = Math.floor(typeP * DEMO_URL.length)
        if (chars !== typedSoFar) {
          typedSoFar = chars
          setTypedUrl(DEMO_URL.slice(0, chars))
        }

        // Phase 2 (0.18 — 0.78): crawl cards cascade
        const crawlP = Math.max(0, Math.min(1, (p - 0.18) / 0.6))
        const pageCount = Math.floor(crawlP * CRAWL_PAGES.length + 0.0001)
        if (pageCount !== pagesSoFar) {
          pagesSoFar = pageCount
          setPagesVisible(pageCount)
        }

        // Phase 3 (> 0.78): ready state
        setReadyVisible(p > 0.78)
      },
    })

    return () => {
      st.kill()
    }
  }, [])

  return (
    <section
      ref={rootRef}
      id="how-it-works"
      className="relative min-h-[100dvh] overflow-hidden"
    >
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col justify-center px-6 py-24">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="lg:sticky lg:top-32">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]">
              How it works
            </p>
            <h2 className="mt-4 text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.05] tracking-tight">
              Paste a URL.
              <br />
              <span className="text-[color:var(--ink-secondary)]">
                We do the rest.
              </span>
            </h2>
            <ol className="mt-10 space-y-4 text-sm text-[color:var(--ink-secondary)]">
              <Narration
                index="01"
                label="Paste"
                body="Any public URL. We validate, fetch the sitemap, kick off the crawl."
                active={typedUrl.length > 0 && pagesVisible === 0}
                done={pagesVisible > 0}
              />
              <Narration
                index="02"
                label="Crawl & index"
                body="Every page read, cleaned, embedded. Up to 100 pages per site."
                active={pagesVisible > 0 && !readyVisible}
                done={readyVisible}
              />
              <Narration
                index="03"
                label="Ready"
                body="One script tag. Any platform. Live in minutes."
                active={readyVisible}
                done={false}
              />
            </ol>
          </div>

          <div className="relative">
            <div className="surface-hairline rounded-xl p-5 shadow-[var(--shadow-md)]">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
                Website URL
              </p>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-hairline)] bg-[color:var(--bg-inset)] px-3 py-2.5 font-mono text-[14px] text-[color:var(--ink-primary)]">
                <span className="inline-flex items-baseline">
                  <span>{typedUrl}</span>
                  {!readyVisible && typedUrl.length < DEMO_URL.length && (
                    <span className="landing-cursor" aria-hidden />
                  )}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors duration-300 ${
                    readyVisible
                      ? 'bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]'
                      : 'bg-[color:var(--bg-subtle)] text-[color:var(--ink-tertiary)]'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${readyVisible ? 'bg-[color:var(--accent-success)]' : 'bg-[color:var(--ink-tertiary)] rc-pulse'}`}
                  />
                  {readyVisible ? 'Ready' : 'Crawling'}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {CRAWL_PAGES.map((p, i) => {
                const shown = i < pagesVisible
                return (
                  <div
                    key={p.path}
                    className="surface-hairline rounded-lg px-4 py-2.5 shadow-[var(--shadow-sm)]"
                    style={{
                      transform: shown ? 'translateY(0)' : 'translateY(12px)',
                      opacity: shown ? 1 : 0,
                      transition:
                        'transform 380ms cubic-bezier(0.32,0.72,0,1), opacity 280ms cubic-bezier(0.32,0.72,0,1)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-[color:var(--ink-primary)]">
                          {p.title}
                        </p>
                        <p className="truncate font-mono text-[11px] text-[color:var(--ink-tertiary)]">
                          {p.path}
                        </p>
                      </div>
                      <IconCheck
                        width={13}
                        height={13}
                        className="shrink-0 text-[color:var(--accent-success)]"
                      />
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-[color:var(--border-hairline)] pt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
                Pages indexed
              </p>
              <p className="font-mono text-2xl tracking-tight text-[color:var(--ink-primary)]">
                <span>{pagesVisible.toString().padStart(2, '0')}</span>
                <span className="text-[color:var(--ink-tertiary)]">
                  /{CRAWL_PAGES.length}
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Narration({
  index,
  label,
  body,
  active,
  done,
}: {
  index: string
  label: string
  body: string
  active: boolean
  done: boolean
}) {
  return (
    <li className="flex items-start gap-4">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
          done
            ? 'border-[color:var(--accent-success)] bg-[color:var(--accent-success-bg)] text-[color:var(--accent-success)]'
            : active
              ? 'border-[color:var(--ink-primary)] text-[color:var(--ink-primary)]'
              : 'border-[color:var(--border-strong)] text-[color:var(--ink-tertiary)]'
        }`}
      >
        {done ? (
          <IconCheck width={11} height={11} />
        ) : active ? (
          <span className="h-1.5 w-1.5 rounded-full bg-current rc-pulse" />
        ) : (
          <span className="font-mono text-[9px]">{index}</span>
        )}
      </span>
      <div className="flex-1">
        <p
          className={`text-[13px] font-semibold tracking-tight transition-colors duration-300 ${
            active
              ? 'text-[color:var(--ink-primary)]'
              : done
                ? 'text-[color:var(--ink-secondary)]'
                : 'text-[color:var(--ink-tertiary)]'
          }`}
        >
          {label}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-[color:var(--ink-secondary)]">
          {body}
        </p>
      </div>
    </li>
  )
}

/* --------------------------------------------------------------------------
   Chat demo — typewriter answer on enter
   -------------------------------------------------------------------------- */

const CHAT_ANSWER =
  "We offer 30-day returns on any unworn item. Just drop us a note at the contact page and we'll send you a prepaid label. [1]"

function ChatDemo() {
  const rootRef = useRef<HTMLElement>(null)
  const [typed, setTyped] = useState(0)
  const [userShown, setUserShown] = useState(false)
  const [citationShown, setCitationShown] = useState(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    if (reducedMotion) {
      /* eslint-disable react-hooks/set-state-in-effect --
         One-shot sync with prefers-reduced-motion; no animation loop. */
      setUserShown(true)
      setTyped(CHAT_ANSWER.length)
      setCitationShown(true)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }

    gsap.registerPlugin(ScrollTrigger)

    const proxy = { n: 0 }
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: root,
        start: 'top 70%',
        end: 'bottom 30%',
        toggleActions: 'play none none reverse',
      },
    })
    tl.call(() => setUserShown(true))
      .to(proxy, {
        n: CHAT_ANSWER.length,
        duration: 2.4,
        ease: 'none',
        onUpdate: () => setTyped(Math.floor(proxy.n)),
      }, '+=0.6')
      .call(() => setCitationShown(true), [], '+=0.15')

    return () => {
      tl.scrollTrigger?.kill()
      tl.kill()
    }
  }, [])

  return (
    <section ref={rootRef} className="relative px-6 py-40">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]">
            What visitors see
          </p>
          <h2 className="mt-4 text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.05] tracking-tight">
            It answers like someone
            <br />
            who works there.
          </h2>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
            Trained only on your pages. Every claim cites a source. When it
            doesn&apos;t know, it offers to collect the visitor&apos;s email
            instead of hallucinating.
          </p>
        </div>

        <div className="surface-hairline rounded-xl p-5 shadow-[var(--shadow-md)]">
          <div className="space-y-3">
            {userShown && (
              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-xl bg-[color:var(--ink-primary)] px-3.5 py-2 text-[14px] leading-relaxed text-[color:var(--bg-surface)] rc-enter">
                  What&apos;s your return policy?
                </div>
              </div>
            )}
            <div className="flex justify-start">
              <div className="max-w-[82%] rounded-xl bg-[color:var(--bg-subtle)] px-3.5 py-2 text-[14px] leading-relaxed text-[color:var(--ink-primary)]">
                {typed === 0 ? (
                  <span className="inline-flex items-center gap-0.5 text-[color:var(--ink-tertiary)]">
                    <Dot />
                    <Dot delay={120} />
                    <Dot delay={240} />
                  </span>
                ) : (
                  <>
                    {CHAT_ANSWER.slice(0, typed)}
                    {typed < CHAT_ANSWER.length && (
                      <span className="landing-cursor" aria-hidden />
                    )}
                  </>
                )}
              </div>
            </div>
            {citationShown && (
              <div className="ml-2 flex items-center gap-2 text-xs text-[color:var(--ink-tertiary)] rc-enter">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[color:var(--border-strong)] font-mono text-[10px] text-[color:var(--ink-secondary)]">
                  1
                </span>
                <span className="font-mono">yourbusiness.com/returns</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function Dot({ delay = 0 }: { delay?: number }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--ink-tertiary)] rc-pulse"
      style={{ animationDelay: `${delay}ms` }}
    />
  )
}

/* --------------------------------------------------------------------------
   Embed scene — line-by-line code reveal
   -------------------------------------------------------------------------- */

const EMBED_LINES = [
  '<!-- RubyCrawl Chat Widget -->',
  '<script',
  '  src="https://firecrawl-rag.vercel.app/rubycrawl-loader.js"',
  '  data-site-key="sk_3c4f…9b2a"',
  '  async',
  '></script>',
]

function EmbedScene() {
  const rootRef = useRef<HTMLElement>(null)
  const [linesShown, setLinesShown] = useState(0)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    if (reducedMotion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync with prefers-reduced-motion
      setLinesShown(EMBED_LINES.length)
      return
    }

    gsap.registerPlugin(ScrollTrigger)

    const proxy = { n: 0 }
    const tween = gsap.to(proxy, {
      n: EMBED_LINES.length,
      duration: 1.4,
      ease: 'power2.out',
      paused: true,
      onUpdate: () => setLinesShown(Math.ceil(proxy.n)),
    })

    const st = ScrollTrigger.create({
      trigger: root,
      start: 'top 70%',
      onEnter: () => tween.play(),
      onLeaveBack: () => tween.reverse(),
    })

    return () => {
      st.kill()
      tween.kill()
    }
  }, [])

  return (
    <section ref={rootRef} className="relative px-6 py-40">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="surface-hairline overflow-hidden rounded-xl">
          <div className="flex items-center justify-between border-b border-[color:var(--border-hairline)] bg-[color:var(--bg-inset)] px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--ink-tertiary)]">
              Embed code
            </p>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-[color:var(--ink-tertiary)]">
              <IconCopy width={11} height={11} />
              <span className="font-mono">Copy</span>
            </span>
          </div>
          <pre className="overflow-x-auto bg-[color:var(--bg-surface)] p-5 text-[12.5px] leading-[1.7]">
            <code className="font-mono text-[color:var(--ink-primary)]">
              {EMBED_LINES.slice(0, linesShown).map((line, i) => (
                <div key={i} className="rc-enter">
                  {line === '' ? '\u00a0' : line}
                </div>
              ))}
            </code>
          </pre>
        </div>

        <div className="order-first lg:order-last">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]">
            One tag. Any platform.
          </p>
          <h2 className="mt-4 text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.05] tracking-tight">
            Paste it. Ship it.
          </h2>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-[color:var(--ink-secondary)]">
            Works on WordPress, Squarespace, Wix, Shopify, Webflow, and plain
            HTML. Loads lazily. Shadow DOM isolates it from your site&apos;s
            CSS, so it never breaks your theme.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-[color:var(--ink-secondary)]">
            <Feat>Under 2KB on first paint</Feat>
            <Feat>Shadow DOM isolation</Feat>
            <Feat>Works without a code change to your theme</Feat>
          </ul>
        </div>
      </div>
    </section>
  )
}

function Feat({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <IconCheck
        width={13}
        height={13}
        className="mt-0.5 shrink-0 text-[color:var(--accent-success)]"
      />
      <span>{children}</span>
    </li>
  )
}

/* --------------------------------------------------------------------------
   Dashboard teaser — parallax rise
   -------------------------------------------------------------------------- */

function DashboardTeaser() {
  const rootRef = useRef<HTMLElement>(null)
  const artRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const art = artRef.current
    if (!root || !art) return

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches
    if (reducedMotion) return

    gsap.registerPlugin(ScrollTrigger)

    const rise = gsap.fromTo(
      art,
      { y: 60, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 1.1,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: root,
          start: 'top 75%',
          toggleActions: 'play none none reverse',
        },
      }
    )

    const drift = gsap.to(art, {
      y: -40,
      ease: 'none',
      scrollTrigger: {
        trigger: root,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 0.8,
      },
    })

    return () => {
      rise.scrollTrigger?.kill()
      rise.kill()
      drift.scrollTrigger?.kill()
      drift.kill()
    }
  }, [])

  return (
    <section ref={rootRef} className="relative px-6 py-40">
      <div className="mx-auto w-full max-w-6xl text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]">
          Your control panel
        </p>
        <h2 className="mx-auto mt-4 max-w-3xl text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.05] tracking-tight">
          See every question your visitors ask.
          <br />
          <span className="text-[color:var(--ink-secondary)]">
            Capture every lead.
          </span>
        </h2>
      </div>

      <div
        ref={artRef}
        className="mx-auto mt-16 grid w-full max-w-5xl grid-cols-1 gap-px overflow-hidden rounded-2xl border border-[color:var(--border-hairline)] bg-[color:var(--border-hairline)] shadow-[var(--shadow-md)] sm:grid-cols-3"
      >
        <MockMetric
          label="Visitors helped"
          value="1,247"
          span="sm:col-span-1 sm:row-span-2"
          emphasis
        />
        <MockMetric label="Messages answered" value="4,812" />
        <MockMetric label="Leads captured" value="86" />
        <div className="col-span-full bg-[color:var(--bg-surface)] p-6 sm:col-span-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
            Recent conversation
          </p>
          <div className="mt-4 space-y-2">
            <p className="font-mono text-[12px] text-[color:var(--ink-primary)]">
              visitor_71c3f_···8aa
            </p>
            <p className="text-[13px] leading-relaxed text-[color:var(--ink-secondary)]">
              &ldquo;Do you ship to Canada?&rdquo;
            </p>
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[color:var(--accent-success-bg)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--accent-success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent-success)] rc-pulse" />
            Active
          </div>
        </div>
      </div>
    </section>
  )
}

function MockMetric({
  label,
  value,
  span,
  emphasis = false,
}: {
  label: string
  value: string
  span?: string
  emphasis?: boolean
}) {
  return (
    <div className={`bg-[color:var(--bg-surface)] p-6 ${span ?? ''}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
        {label}
      </p>
      <p
        className={`mt-2 font-mono tracking-tight text-[color:var(--ink-primary)] ${emphasis ? 'text-5xl' : 'text-3xl'}`}
      >
        {value}
      </p>
    </div>
  )
}

/* --------------------------------------------------------------------------
   Pricing
   -------------------------------------------------------------------------- */

function Pricing() {
  return (
    <section className="relative px-6 py-40">
      <div className="mx-auto max-w-xl text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-tertiary)]">
          Pricing
        </p>
        <h2 className="mt-4 text-[clamp(1.75rem,3.5vw,2.75rem)] font-semibold leading-[1.05] tracking-tight">
          One plan.
          <br />
          <span className="text-[color:var(--ink-secondary)]">
            Built for small businesses.
          </span>
        </h2>
      </div>

      <div className="surface-hairline mx-auto mt-14 max-w-md rounded-2xl p-8 shadow-[var(--shadow-md)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:var(--ink-tertiary)]">
          RubyCrawl Standard
        </p>
        <p className="mt-3 flex items-baseline gap-1 font-mono tracking-tight text-[color:var(--ink-primary)]">
          <span className="text-5xl">$24.99</span>
          <span className="text-sm text-[color:var(--ink-tertiary)]">
            /month
          </span>
        </p>
        <p className="mt-1 text-xs text-[color:var(--ink-tertiary)]">
          7-day free trial. Cancel anytime.
        </p>

        <ul className="mt-8 space-y-2.5 text-sm text-[color:var(--ink-secondary)]">
          <Feat>Crawl up to 100 pages</Feat>
          <Feat>500 chat messages / month</Feat>
          <Feat>Lead capture + CSV export</Feat>
          <Feat>Calendly & Google Maps integrations</Feat>
          <Feat>Dashboard with live metrics</Feat>
          <Feat>Embeddable widget (any platform)</Feat>
        </ul>

        <Link
          href="/login"
          className="btn-press focus-ring group mt-10 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[color:var(--ink-primary)] px-5 py-3 text-sm font-medium text-[color:var(--bg-surface)] hover:bg-[color:var(--ink-secondary)]"
        >
          <IconSparkle width={14} height={14} />
          <span>Start free trial</span>
          <IconArrowRight
            width={14}
            height={14}
            className="transition-transform duration-200 group-hover:translate-x-0.5"
          />
        </Link>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------------
   Footer
   -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-[color:var(--border-hairline)] px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="font-mono text-[11px] tracking-tight text-[color:var(--ink-tertiary)]">
          © 2026 RubyCrawl. All rights reserved.
        </p>
        <div className="flex items-center gap-6 text-xs text-[color:var(--ink-tertiary)]">
          <Link href="/login" className="hover:text-[color:var(--ink-primary)]">
            Sign in
          </Link>
          <a
            href="mailto:hello@rubycrawl.com"
            className="hover:text-[color:var(--ink-primary)]"
          >
            hello@rubycrawl.com
          </a>
        </div>
      </div>
    </footer>
  )
}
