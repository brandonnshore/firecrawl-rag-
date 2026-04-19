import { test, expect } from './fixtures/auth'
import { seedSite, cleanupUserData } from './fixtures/seed'

// M9F6 e2e-responses-crud
// Fulfills: VAL-RESP-001..006, VAL-RESP-012

test.describe('custom responses dashboard', () => {
  test.beforeEach(async ({ seededUser }) => {
    await seedSite({ userId: seededUser.userId, crawlStatus: 'ready' })
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('empty state visible for a user with no rules (VAL-RESP-001)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/responses')
    await expect(
      authedPage.getByText(/no custom responses yet/i)
    ).toBeVisible()
    await expect(
      authedPage.getByRole('button', { name: /add.*first response/i })
    ).toBeVisible()
  })

  test('modal validates required fields (VAL-RESP-002)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/responses')
    // Count POST /api/responses before clicking Save to prove nothing
    // escapes the client validator.
    const posts: string[] = []
    await authedPage.route('**/api/responses', (route) => {
      if (route.request().method() === 'POST') {
        posts.push(route.request().url())
      }
      route.continue()
    })

    await authedPage
      .getByRole('button', { name: /add.*first response/i })
      .click()
    // Submit empty form.
    await authedPage.getByRole('button', { name: /^save$/i }).click()
    // Per-field errors should appear for triggers and response.
    await expect(
      authedPage.getByText(/at least one trigger|triggers required/i).first()
    ).toBeVisible()
    expect(posts).toEqual([])
  })

  test('create a keyword rule (VAL-RESP-003) + chip rendering (VAL-RESP-005)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/responses')
    await authedPage
      .getByRole('button', { name: /add.*first response/i })
      .click()

    // trigger_type defaults to keyword. Target the triggers <input type="text">
    // inside the modal form — it's the only text input on the form.
    const modal = authedPage.getByRole('dialog')
    const triggerInput = modal.locator('input[type="text"]').first()
    await triggerInput.fill('pricing')
    await triggerInput.press('Enter')
    await triggerInput.fill('cost')
    await triggerInput.press('Enter')

    await modal.locator('textarea').first().fill('Our pricing starts at $49/mo.')
    await modal.getByRole('button', { name: /^save$/i }).click()

    // Row appears in the list body.
    await expect(
      authedPage.getByText('Our pricing starts at $49/mo.')
    ).toBeVisible({ timeout: 5000 })
    // Trigger chips render as <span> pills with the trigger text.
    await expect(authedPage.getByText('pricing', { exact: true })).toBeVisible()
    await expect(authedPage.getByText('cost', { exact: true })).toBeVisible()
  })

  test('create an intent rule (VAL-RESP-004)', async ({ authedPage }) => {
    await authedPage.goto('/dashboard/settings/responses')
    await authedPage
      .getByRole('button', { name: /add.*first response/i })
      .click()
    await authedPage.locator('select').selectOption('intent')
    const triggerInput = authedPage.locator('input[type="text"]').first()
    await triggerInput.fill('hours')
    await triggerInput.press('Enter')
    await authedPage
      .locator('textarea')
      .first()
      .fill("We're open 9 to 5.")
    await authedPage.getByRole('button', { name: /^save$/i }).click()
    await expect(authedPage.getByText("We're open 9 to 5.")).toBeVisible({
      timeout: 5000,
    })
    await expect(authedPage.getByText(/intent/i).first()).toBeVisible()
  })

  test('test drawer returns matched result for a keyword rule (VAL-RESP-006)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/responses')
    // Seed a rule first.
    await authedPage
      .getByRole('button', { name: /add.*first response/i })
      .click()
    const modal = authedPage.getByRole('dialog')
    await modal.locator('input[type="text"]').first().fill('pricing')
    await modal.locator('input[type="text"]').first().press('Enter')
    await modal.locator('textarea').first().fill('Our pricing is $49/mo.')
    await modal.getByRole('button', { name: /^save$/i }).click()
    await expect(authedPage.getByText('Our pricing is $49/mo.')).toBeVisible()

    // Open the Test drawer.
    await authedPage.getByRole('button', { name: /^test$/i }).click()
    const drawer = authedPage.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await drawer.locator('textarea').fill("What's the pricing?")
    await drawer.getByRole('button', { name: /run matcher|running/i }).click()
    await expect(drawer.getByText(/Matched/i).first()).toBeVisible({
      timeout: 5000,
    })
    await expect(drawer.getByText('Our pricing is $49/mo.')).toBeVisible()
  })

  test('delete removes the rule (VAL-RESP-012)', async ({ authedPage }) => {
    await authedPage.goto('/dashboard/settings/responses')
    // Seed one rule via UI.
    await authedPage
      .getByRole('button', { name: /add.*first response/i })
      .click()
    const modal = authedPage.getByRole('dialog')
    await modal.locator('input[type="text"]').first().fill('delete-me')
    await modal.locator('input[type="text"]').first().press('Enter')
    await modal.locator('textarea').first().fill('I will be deleted.')
    await modal.getByRole('button', { name: /^save$/i }).click()
    await expect(authedPage.getByText('I will be deleted.')).toBeVisible()

    // Browser native confirm() is used for delete — auto-accept it.
    authedPage.once('dialog', (d) => d.accept())
    await authedPage.getByRole('button', { name: /^delete$/i }).first().click()
    await expect(authedPage.getByText('I will be deleted.')).toBeHidden({
      timeout: 5000,
    })
  })
})
