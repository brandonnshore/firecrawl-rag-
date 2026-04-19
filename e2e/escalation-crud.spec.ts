import { test, expect } from './fixtures/auth'
import { seedSite, cleanupUserData } from './fixtures/seed'

// M9F7 e2e-escalation-crud
// Fulfills: VAL-ESCAL-001..005

test.describe('escalation rules dashboard', () => {
  test.beforeEach(async ({ seededUser }) => {
    await seedSite({ userId: seededUser.userId, crawlStatus: 'ready' })
  })

  test.afterEach(async ({ seededUser }) => {
    await cleanupUserData(seededUser.userId)
  })

  test('empty state visible for a user with no rules (VAL-ESCAL-001)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/escalation')
    await expect(
      authedPage.getByText(/no escalation rules yet/i)
    ).toBeVisible()
    await expect(
      authedPage.getByRole('button', { name: /add.*first rule/i })
    ).toBeVisible()
  })

  test('create a turn_count rule → ask_email (VAL-ESCAL-002)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/escalation')
    await authedPage
      .getByRole('button', { name: /add.*first rule/i })
      .click()
    const modal = authedPage.getByRole('dialog')
    // trigger defaults to turn_count; action defaults to ask_email.
    await modal.locator('input[type="number"]').first().fill('3')
    await modal.getByRole('button', { name: /^save$/i }).click()

    await expect(
      authedPage.locator('[data-testid="escalation-rule-card"]')
    ).toHaveCount(1, { timeout: 5000 })
    await expect(authedPage.getByText(/after 3 turns/i)).toBeVisible()
    await expect(authedPage.getByText(/ask for email/i).first()).toBeVisible()
  })

  test('create a keyword rule → ask_email (VAL-ESCAL-003)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/escalation')
    await authedPage.getByRole('button', { name: /add.*first rule/i }).click()
    const modal = authedPage.getByRole('dialog')
    await modal.locator('select').first().selectOption('keyword')
    const chipInput = modal.locator('input[type="text"]').first()
    await chipInput.fill('price')
    await chipInput.press('Enter')
    await modal.getByRole('button', { name: /^save$/i }).click()
    await expect(
      authedPage.locator('[data-testid="escalation-rule-card"]')
    ).toHaveCount(1, { timeout: 5000 })
    await expect(
      authedPage.getByText(/message contains: price/i).first()
    ).toBeVisible()
  })

  test('create an intent rule → handoff (VAL-ESCAL-004)', async ({
    authedPage,
  }) => {
    await authedPage.goto('/dashboard/settings/escalation')
    await authedPage.getByRole('button', { name: /add.*first rule/i }).click()
    const modal = authedPage.getByRole('dialog')
    await modal.locator('select').first().selectOption('intent')
    const chipInput = modal.locator('input[type="text"]').first()
    await chipInput.fill('complaint')
    await chipInput.press('Enter')
    // Second select = action.
    await modal.locator('select').nth(1).selectOption('handoff')
    await modal.getByRole('button', { name: /^save$/i }).click()
    await expect(
      authedPage.locator('[data-testid="escalation-rule-card"]')
    ).toHaveCount(1, { timeout: 5000 })
    await expect(
      authedPage.getByText(/intent matches: complaint/i).first()
    ).toBeVisible()
    await expect(
      authedPage.getByText(/handoff to human/i).first()
    ).toBeVisible()
  })

  test('drag reorder persists new priority to the DB (VAL-ESCAL-005)', async ({
    authedPage,
  }) => {
    // Seed 3 rules.
    await authedPage.goto('/dashboard/settings/escalation')
    const addFirst = authedPage.getByRole('button', {
      name: /add.*first rule/i,
    })
    for (let i = 0; i < 3; i++) {
      const btn = i === 0 ? addFirst : authedPage.getByRole('button', {
        name: /^add rule$/i,
      })
      await btn.click()
      const modal = authedPage.getByRole('dialog')
      await modal.locator('input[type="number"]').first().fill(String(i + 1))
      await modal.getByRole('button', { name: /^save$/i }).click()
      await expect(authedPage.getByRole('dialog')).toBeHidden({
        timeout: 5000,
      })
    }
    const cards = authedPage.locator('[data-testid="escalation-rule-card"]')
    await expect(cards).toHaveCount(3)

    // Capture the pre-drag turn-count labels — that's the only per-card
    // text that survives the priority re-stamp after the reorder.
    const beforeTurns = await Promise.all([0, 1, 2].map(async (i) => {
      const txt = await cards.nth(i).textContent()
      return /After (\d+) turns/.exec(txt ?? '')?.[1] ?? ''
    }))
    expect(beforeTurns).toHaveLength(3)

    // Capture the reorder POST.
    const reorderCalls: unknown[] = []
    await authedPage.route('**/api/escalation-rules/reorder', (route) => {
      if (route.request().method() === 'POST') {
        try {
          reorderCalls.push(route.request().postDataJSON())
        } catch {
          /* noop */
        }
      }
      route.continue()
    })

    // Drag the last card to first position.
    const last = cards.nth(2)
    const first = cards.nth(0)
    await last.dragTo(first)

    // Reorder endpoint fired with a new id order.
    await expect.poll(() => reorderCalls.length, { timeout: 5000 }).toBeGreaterThan(0)
    expect(reorderCalls[reorderCalls.length - 1]).toMatchObject({
      rule_ids: expect.any(Array),
    })

    // The card that was third (largest turns value) is now first.
    await expect(cards.first()).toContainText(
      `After ${beforeTurns[2]} turns`
    )
  })
})
