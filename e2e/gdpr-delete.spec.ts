import { test, expect } from './fixtures/auth'
import { seedSite, cleanupUserData } from './fixtures/seed'

// M9F5 e2e-gdpr-delete
// Fulfills: VAL-GDPR-001, VAL-GDPR-002

test.describe('Delete my account UI (VAL-GDPR-001)', () => {
  test.beforeEach(async ({ seededUser }) => {
    await seedSite({ userId: seededUser.userId, crawlStatus: 'ready' })
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('red delete-account section is visible at the bottom of /settings/site', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/site')

    const heading = authedPage.getByRole('heading', {
      name: /delete my account/i,
    })
    await expect(heading).toBeVisible()

    // Destructive CTA uses the red button styling. Use role=button and
    // the visible text (the section's paragraph also mentions deletion,
    // so pick the button specifically).
    const deleteBtn = authedPage.getByRole('button', {
      name: /^delete my account$/i,
    })
    await expect(deleteBtn).toBeVisible()
    // Explanation text cites the scope of deletion.
    await expect(
      authedPage.getByText(/permanently erases|cannot be undone/i)
    ).toBeVisible()
  })
})

test.describe('Delete account modal (VAL-GDPR-002)', () => {
  test.beforeEach(async ({ seededUser }) => {
    await seedSite({ userId: seededUser.userId, crawlStatus: 'ready' })
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('modal opens and Delete is disabled until email matches', async ({
    authedPage,
    seededUser,
  }) => {
    await authedPage.goto('/dashboard/settings/site')
    await authedPage
      .getByRole('button', { name: /^delete my account$/i })
      .click()

    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/confirm account deletion/i)

    const confirmBtn = dialog.getByRole('button', { name: /^delete account$/i })
    await expect(confirmBtn).toBeDisabled()

    const emailInput = dialog.locator('input[type="email"]')
    await emailInput.fill('not-my-email@example.com')
    await expect(confirmBtn).toBeDisabled()

    await emailInput.fill(seededUser.email)
    await expect(confirmBtn).toBeEnabled()
  })

  test('Cancel closes the modal with zero side-effects', async ({
    authedPage,
    seededUser,
  }) => {
    // Capture any DELETE /api/account requests while the modal is open.
    const deletes: string[] = []
    await authedPage.route('**/api/account', (route) => {
      if (route.request().method() === 'DELETE') {
        deletes.push(route.request().url())
      }
      route.continue()
    })

    await authedPage.goto('/dashboard/settings/site')
    await authedPage
      .getByRole('button', { name: /^delete my account$/i })
      .click()
    const dialog = authedPage.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Fill so the Delete button enables, to prove Cancel doesn't accidentally submit.
    await dialog.locator('input[type="email"]').fill(seededUser.email)
    await dialog.getByRole('button', { name: /^cancel$/i }).click()

    await expect(dialog).toBeHidden()
    expect(deletes).toEqual([])

    // User is still logged in (no redirect, dashboard reachable).
    await authedPage.goto('/dashboard/settings/site')
    await expect(
      authedPage.getByRole('heading', { name: /delete my account/i })
    ).toBeVisible()
  })
})
