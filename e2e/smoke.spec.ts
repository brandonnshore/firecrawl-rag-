import { test, expect } from '@playwright/test'

test.describe('smoke', () => {
  test('unauthenticated /dashboard redirects to /login', async ({ page }) => {
    const response = await page.goto('/dashboard')
    expect(response, 'navigation should return a response').toBeTruthy()
    await expect(page).toHaveURL(/\/login/)
  })

  test('login page renders', async ({ page }) => {
    await page.goto('/login')
    await expect(page.locator('body')).toBeVisible()
  })
})
