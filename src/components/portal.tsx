'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Renders children into document.body so they escape any ancestor that
// establishes a containing block for position: fixed (e.g. `.rc-enter`
// which retains a `transform` via animation-fill-mode: both, pulling
// modals out of the viewport).
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}
