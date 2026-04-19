import { test, expect } from './fixtures/auth'

// Smoke spec for the Playwright auth fixture (M9F1). Proves:
//   - createSeededUser inserts an auth.users row
//   - authedPage carries the cookie past the /dashboard auth middleware

test('authedPage lands on /dashboard without being redirected to /login', async ({
  authedPage,
  seededUser,
}) => {
  const response = await authedPage.goto('/dashboard')
  expect(response, 'navigation should produce a response').toBeTruthy()
  expect(response!.url()).not.toMatch(/\/login/)
  // The dashboard shell renders the logged-in user's email somewhere.
  await expect(authedPage.getByText(seededUser.email)).toBeVisible({
    timeout: 5000,
  })
})

test('unauthenticated plain page still redirects to /login', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})
