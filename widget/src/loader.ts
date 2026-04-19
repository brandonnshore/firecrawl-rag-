import {
  preflightWidgetConfig,
  type PreflightStatus,
} from './preflight'

const currentScript = document.currentScript as HTMLScriptElement | null
const siteKey = currentScript?.getAttribute('data-site-key') || ''
const apiBase =
  currentScript?.getAttribute('data-api-base') || window.location.origin

const POLL_INTERVAL_MS = 60_000
const PREFLIGHT_TIMEOUT_MS = 3_000

declare global {
  interface Window {
    RubyCrawlWidget?: {
      mount: (
        container: HTMLElement,
        config: { siteKey: string; apiBase: string },
        shadow: ShadowRoot
      ) => void
      getStyles: () => string
    }
  }
}

if (!siteKey) {
  console.error('[RubyCrawl] Missing data-site-key attribute')
} else {
  initWidget(siteKey, apiBase)
}

function initWidget(siteKey: string, apiBase: string) {
  const container = document.createElement('div')
  container.id = 'rubycrawl-root'
  document.body.appendChild(container)

  const shadow = container.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = getBubbleCSS()
  shadow.appendChild(style)

  let bubbleMounted = false
  let degradedWarned = false

  const run = async () => {
    const { status } = await preflightWidgetConfig({
      fetchFn: window.fetch.bind(window),
      apiBase,
      siteKey,
      timeoutMs: PREFLIGHT_TIMEOUT_MS,
    })

    if (status === 'ready' && !bubbleMounted) {
      bubbleMounted = true
      mountBubble(shadow, siteKey, apiBase)
      return
    }

    if (status === 'degraded') {
      // Log once, not on every poll. VAL-DEGRADE-001.
      if (!degradedWarned) {
        console.warn('[RubyCrawl] API unreachable — chat hidden. Will retry.')
        degradedWarned = true
      }
      scheduleRetry(run)
      return
    }

    if (status === 'silent') {
      // 402 or 404 — never surface billing or misconfiguration to the
      // visitor. Still poll in case the owner re-activates.
      scheduleRetry(run)
      return
    }
  }

  run()
}

function scheduleRetry(fn: () => void) {
  setTimeout(fn, POLL_INTERVAL_MS)
}

function mountBubble(
  shadow: ShadowRoot,
  siteKey: string,
  apiBase: string
): void {
  const bubble = document.createElement('button')
  bubble.className = 'rc-bubble'
  bubble.setAttribute('aria-label', 'Open chat')
  bubble.setAttribute('aria-expanded', 'false')
  bubble.innerHTML = chatIconSVG()
  shadow.appendChild(bubble)

  let panelLoaded = false
  let panelVisible = false

  bubble.addEventListener('click', () => {
    panelVisible = !panelVisible
    bubble.setAttribute('aria-expanded', String(panelVisible))
    bubble.innerHTML = panelVisible ? closeIconSVG() : chatIconSVG()

    if (!panelLoaded) {
      panelLoaded = true
      loadFullWidget(shadow, siteKey, apiBase)
    } else {
      const panel = shadow.querySelector('.rc-panel') as HTMLElement | null
      if (panel) panel.style.display = panelVisible ? 'flex' : 'none'
    }
  })
}

function loadFullWidget(shadow: ShadowRoot, siteKey: string, apiBase: string) {
  const scriptSrc = getWidgetScriptUrl()
  const script = document.createElement('script')
  script.src = scriptSrc
  script.onload = () => {
    const Widget = window.RubyCrawlWidget
    if (Widget) {
      const widgetStyle = document.createElement('style')
      widgetStyle.textContent = Widget.getStyles()
      shadow.appendChild(widgetStyle)

      const panelContainer = document.createElement('div')
      shadow.appendChild(panelContainer)

      Widget.mount(panelContainer, { siteKey, apiBase }, shadow)
    }
  }
  document.head.appendChild(script)
}

function getWidgetScriptUrl(): string {
  if (currentScript?.src) {
    return currentScript.src.replace(
      'rubycrawl-loader.js',
      'rubycrawl-widget.js'
    )
  }
  return '/rubycrawl-widget.js'
}

function chatIconSVG(): string {
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>'
}

function closeIconSVG(): string {
  return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
}

// Export types for consumers (e.g., tests)
export type { PreflightStatus }

function getBubbleCSS(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .rc-bubble {
      position: fixed; bottom: 20px; right: 20px;
      width: 60px; height: 60px; border-radius: 50%;
      background: #6366f1; color: white; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 999999;
      transition: transform 0.2s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .rc-bubble:hover { transform: scale(1.1); }
    @media (prefers-reduced-motion: reduce) {
      .rc-bubble { transition: none; }
      .rc-bubble:hover { transform: none; }
    }
  `
}
