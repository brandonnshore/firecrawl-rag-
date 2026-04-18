import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    passWithNoTests: true,
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/lib/**/*.d.ts',
        'src/lib/**/__tests__/**',
        'src/lib/**/*.test.ts',
        // Thin wrappers around SDK constructors — no branching logic.
        'src/lib/supabase/client.ts',
        'src/lib/supabase/server.ts',
        'src/lib/supabase/service.ts',
        'src/lib/supabase/proxy.ts',
        // Stub replaced in M2 billing-stripe milestone.
        'src/lib/subscription.ts',
        // Covered by integration tests (require running Supabase / Redis).
        'src/lib/chat/session-store.ts',
        'src/lib/chat/query-rewrite.ts',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 70,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
