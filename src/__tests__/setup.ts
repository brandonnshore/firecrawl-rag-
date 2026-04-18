/**
 * Vitest setup — runs once per test file before any test. Keep this tiny.
 * Integration suites that need live Supabase gate themselves with
 * describe.skipIf(!hasSupabaseTestEnv()) to stay CI-friendly.
 */

import { beforeAll } from 'vitest'

beforeAll(() => {
  // Deterministic tests: no real network, no random wall clock.
  // (Feature tests add more specific setup as needed.)
})
