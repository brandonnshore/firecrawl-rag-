import { test, expect } from './fixtures/auth'

// M9F2 e2e-auth-gates
// Fulfills: VAL-AUTH-007, VAL-AUTH-008, VAL-AUTH-010, VAL-CROSS-008, VAL-CROSS-009

const PROTECTED_ROUTES = [
  '/dashboard',
  '/dashboard/setup',
  '/dashboard/preview',
  '/dashboard/embed',
  '/dashboard/leads',
  '/dashboard/conversations',
  '/dashboard/settings',
  '/dashboard/settings/site',
  '/dashboard/settings/knowledge',
  '/dashboard/settings/responses',
  '/dashboard/settings/escalation',
  '/dashboard/settings/billing',
  '/dashboard/billing',
]

test.describe('unauthenticated dashboard routes (VAL-CROSS-008)', () => {
  for (const path of PROTECTED_ROUTES) {
    test(`${path} redirects to /login`, async ({ page }) => {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded' })
      expect(res, 'navigation should produce a response').toBeTruthy()
      await expect(page).toHaveURL(/\/login/)
    })
  }
})

test.describe('authenticated dashboard session (VAL-AUTH-007/008)', () => {
  test('session reaches /dashboard and renders the user email', async ({
    authedPage,
    seededUser,
  }) => {
    await authedPage.goto('/dashboard')
    expect(authedPage.url()).not.toMatch(/\/login/)
    await expect(authedPage.getByText(seededUser.email)).toBeVisible({
      timeout: 5000,
    })
  })

  test('session persists across page reload (VAL-AUTH-008)', async ({
    authedPage,
    seededUser,
  }) => {
    await authedPage.goto('/dashboard')
    await expect(authedPage.getByText(seededUser.email)).toBeVisible()
    await authedPage.reload()
    expect(authedPage.url()).not.toMatch(/\/login/)
    await expect(authedPage.getByText(seededUser.email)).toBeVisible()
  })
})

test.describe('sign-out flow (VAL-AUTH-010)', () => {
  test('sign-out clears cookies and redirects; subsequent /dashboard goes to /login', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard')
    // Find the sign-out control in the sidebar. Use a tolerant accessible name.
    const signOut = authedPage.getByRole('button', { name: /sign.?out/i })
    await expect(signOut).toBeVisible({ timeout: 5000 })
    await signOut.click()
    // Wait for the post-signout navigation to settle.
    await authedPage.waitForURL((url) => !url.pathname.startsWith('/dashboard'), {
      timeout: 8000,
    })
    // Revisiting /dashboard now bounces to /login.
    await authedPage.goto('/dashboard')
    await expect(authedPage).toHaveURL(/\/login/)
  })
})

test.describe('API auth boundaries (VAL-CROSS-009)', () => {
  test('POST /api/crawl/start without auth returns 401', async ({
    request,
  }) => {
    const res = await request.post('/api/crawl/start', {
      data: { url: 'https://example.com' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/chat/session without site_key returns 400', async ({
    request,
  }) => {
    const res = await request.post('/api/chat/session', {
      data: { message: 'hello' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/chat/session with bogus site_key returns 404', async ({
    request,
  }) => {
    const res = await request.post('/api/chat/session', {
      data: { message: 'hello', site_key: 'sk_bogus_nonexistent' },
    })
    expect(res.status()).toBe(404)
  })

  test('DELETE /api/account without auth returns 401', async ({ request }) => {
    const res = await request.delete('/api/account', {
      data: { email: 'x@y.com' },
    })
    expect(res.status()).toBe(401)
  })
})
