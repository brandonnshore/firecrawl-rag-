const currentScript = document.currentScript as HTMLScriptElement | null
const siteKey = currentScript?.getAttribute('data-site-key') || ''
const apiBase =
  currentScript?.getAttribute('data-api-base') || window.location.origin

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

  checkSiteReady(siteKey, apiBase).then((ready) => {
    if (!ready) return

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
  })
}

async function checkSiteReady(
  siteKey: string,
  apiBase: string
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase}/api/chat/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_key: siteKey, message: '__healthcheck__' }),
    })
    return res.status !== 503 && res.status !== 404
  } catch {
    return false
  }
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
