import { test, expect } from './fixtures/auth'
import { seedSite, cleanupUserData } from './fixtures/seed'

// M9F4 e2e-settings-navigation
// Fulfills: VAL-SET-003, VAL-SET-005, VAL-SET-006, VAL-SET-008, VAL-CROSS-007

const SUB_ROUTES = [
  { path: '/dashboard/settings/site', label: /^Site$/ },
  { path: '/dashboard/settings/knowledge', label: /^Knowledge$/ },
  { path: '/dashboard/settings/responses', label: /^Responses$/ },
  { path: '/dashboard/settings/escalation', label: /^Escalation$/ },
  { path: '/dashboard/settings/billing', label: /^Billing$/ },
]

test.describe('settings sidebar navigation', () => {
  test.beforeEach(async ({ seededUser }) => {
    await seedSite({ userId: seededUser.userId, crawlStatus: 'ready' })
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('all 5 sub-routes render and each highlights active (VAL-SET-003, VAL-CROSS-007)', async ({
    authedPage,
  }) => {
    for (const { path, label } of SUB_ROUTES) {
      await authedPage.goto(path)
      // Active link has aria-current="page". Two render on the page at
      // once (desktop sidebar + mobile tab strip), so assert at least one
      // and scope the visibility check to the desktop aside where tests
      // run at default viewport.
      const active = authedPage.locator(
        `a[href="${path}"][aria-current="page"]`
      )
      const count = await active.count()
      expect(count).toBeGreaterThanOrEqual(1)
      await expect(active.first()).toContainText(label)
    }
  })

  test('saving site settings triggers a toast (VAL-SET-006)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/site')
    // Trigger a trivial mutation so Save has something to do.
    const greeting = authedPage.getByLabel(/greeting/i)
    if (await greeting.isVisible().catch(() => false)) {
      await greeting.fill('Playwright hello')
    }
    const save = authedPage.getByRole('button', { name: /^save/i }).first()
    await save.click()
    // Sonner toasts render role=status inside [data-sonner-toaster].
    await expect(
      authedPage.locator('[data-sonner-toaster]').getByText(/saved/i)
    ).toBeVisible({ timeout: 5000 })
  })

  test('rotate site key updates the displayed key and fires a toast (VAL-SET-005)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/site')
    // The rendered key is truncated: sk_abcdef1234…ff99aa. Target the
    // <code> block by its ellipsis content so we get a stable locator.
    const codeKey = authedPage.locator('code').filter({ hasText: '…' }).first()
    await expect(codeKey).toBeVisible()
    const keyBefore = await codeKey.textContent()
    expect(keyBefore).toBeTruthy()

    // The trigger button is labelled "Rotate key" (both the initial and
    // the confirm buttons share the label; scope to visible elements).
    await authedPage.getByRole('button', { name: 'Rotate key' }).first().click()
    // Modal opens via native <dialog>; the inner confirm button has the
    // same label. Click the one inside the open dialog.
    const confirm = authedPage.locator('dialog[open]').getByRole('button', {
      name: /rotate key|rotating/i,
    })
    await expect(confirm).toBeVisible()
    await confirm.click()

    await expect(
      authedPage.locator('[data-sonner-toaster]').getByText(/rotated/i)
    ).toBeVisible({ timeout: 5000 })

    // Wait for the displayed code block to change. Its text-content will
    // differ once onRotated runs setSiteKey.
    await expect(codeKey).not.toHaveText(keyBefore!, { timeout: 5000 })
  })

  test('mobile viewport (375px) collapses sidebar into a tab strip (VAL-SET-008)', async ({
    authedPage,
  }) => {
    await authedPage.setViewportSize({ width: 375, height: 800 })
    await authedPage.goto('/dashboard/settings/site')
    // The desktop aside is hidden (sm:block / hidden); the mobile nav is
    // the one with overflow-x-auto. Assert the desktop aside is not
    // visible and the mobile nav IS visible with all 5 items.
    const mobileNav = authedPage.locator(
      'nav[aria-label="Settings sections"].sm\\:hidden'
    )
    await expect(mobileNav).toBeVisible()
    for (const { label } of SUB_ROUTES) {
      await expect(mobileNav.getByRole('link', { name: label })).toBeVisible()
    }
    // Desktop aside should be hidden.
    const desktopAside = authedPage.locator(
      'aside[aria-label="Settings sections"]'
    )
    await expect(desktopAside).toBeHidden()
  })
})
