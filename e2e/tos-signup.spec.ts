import { test, expect } from '@playwright/test'

// M9F3 e2e-tos-signup
// Fulfills: VAL-TOS-001, VAL-TOS-002

test.describe('/login ToS acceptance (VAL-TOS-001)', () => {
  test('submit button is disabled until the ToS checkbox is checked', async ({
    page,
  }) => {
    await page.goto('/login')

    await page.getByLabel(/email/i).fill('e2e-tos@rubycrawl.test')

    const submit = page.getByRole('button', { name: /send magic link/i })
    await expect(submit).toBeDisabled()
    // aria-disabled also set, not just the native disabled attribute.
    await expect(submit).toHaveAttribute('aria-disabled', 'true')

    // Tick the ToS checkbox.
    const checkbox = page.getByRole('checkbox')
    await checkbox.check()

    await expect(submit).toBeEnabled()
  })

  test('no network request fires when the form is submitted without the checkbox', async ({
    page,
  }) => {
    const authRequests: string[] = []
    await page.route('**/*auth/v1/**', (route) => {
      authRequests.push(route.request().url())
      route.continue()
    })
    await page.goto('/login')
    await page.getByLabel(/email/i).fill('e2e-no-submit@rubycrawl.test')
    // Force-click the submit even though it's disabled — ensures the
    // handler's guard (not just the browser's `disabled`) prevents a send.
    const submit = page.getByRole('button', { name: /send magic link/i })
    await submit.click({ force: true }).catch(() => {
      /* button may intercept */
    })
    // Nothing should have fired at GoTrue.
    expect(authRequests).toEqual([])
  })
})

test.describe('/terms link (VAL-TOS-002)', () => {
  test('the Terms of Service link points at /terms and opens in a new tab', async ({
    page,
  }) => {
    await page.goto('/login')
    const link = page.getByRole('link', { name: /terms of service/i })
    await expect(link).toHaveAttribute('href', '/terms')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  })

  test('clicking the link opens /terms in a new tab', async ({
    page,
    context,
  }) => {
    await page.goto('/login')
    const pagePromise = context.waitForEvent('page')
    await page.getByRole('link', { name: /terms of service/i }).click()
    const newTab = await pagePromise
    await newTab.waitForLoadState('domcontentloaded')
    await expect(newTab).toHaveURL(/\/terms$/)
  })
})
