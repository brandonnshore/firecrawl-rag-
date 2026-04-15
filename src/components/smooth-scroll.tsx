'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

/**
 * Lenis smooth scroll wired to GSAP's ticker so ScrollTrigger `scrub`
 * stays perfectly in sync with smooth-scroll position.  This is the
 * bit every Awwwards site gets right and every cargo-culted repo gets
 * wrong — without this, scrubbed timelines feel a frame behind.
 *
 * Scoped: mount only inside pages that want smooth scroll (landing).
 * Do NOT move into the root layout — the authenticated dashboard uses
 * its own internal scroll container and should stay native.
 */
export function SmoothScroll() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 2,
    })

    lenis.on('scroll', ScrollTrigger.update)

    const tick = (time: number) => {
      lenis.raf(time * 1000)
    }
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
    }
  }, [])

  return null
}
