import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — one worker (serial) for shared-DB stability.
 * Each spec cleans up its own data. E2E against a real Next.js dev server
 * on port 3000 with external APIs stubbed per-spec via page.route.
 *
 * The webServer is force-pointed at the LOCAL Supabase stack so cookie
 * injection from e2e/fixtures/auth.ts round-trips against the same DB
 * the spec seeds. Overrides .env.local for the dev subprocess only.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Local Supabase credentials must be passed via env vars — NEVER
      // hardcoded. Run with:
      //   eval "$(supabase status --output env | sed 's/^/SUPABASE_TEST_/; s/=/=/')" \
      //   pnpm exec playwright test
      // or set SUPABASE_TEST_ANON_KEY + SUPABASE_TEST_SERVICE_ROLE_KEY.
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.SUPABASE_TEST_URL ||
        'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        process.env.SUPABASE_TEST_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        '',
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        '',
      OPENAI_API_KEY: 'sk-e2e-placeholder',
      FIRECRAWL_API_KEY: 'fc-e2e-placeholder',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      STRIPE_SECRET_KEY: 'sk_test_e2e_placeholder',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_e2e_placeholder',
    },
  },
})
