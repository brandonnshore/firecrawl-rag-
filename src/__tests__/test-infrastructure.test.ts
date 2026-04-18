import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../..')

function readJson<T = Record<string, unknown>>(p: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, p), 'utf8')) as T
}

describe('M1F1 test infrastructure', () => {
  const pkg = readJson<{
    scripts: Record<string, string>
    devDependencies: Record<string, string>
  }>('package.json')

  describe('devDependencies', () => {
    it('has @vitest/coverage-v8', () => {
      expect(pkg.devDependencies['@vitest/coverage-v8']).toBeDefined()
    })
    it('has @playwright/test', () => {
      expect(pkg.devDependencies['@playwright/test']).toBeDefined()
    })
    it('has fast-check', () => {
      expect(pkg.devDependencies['fast-check']).toBeDefined()
    })
    it('has pdf-lib', () => {
      expect(pkg.devDependencies['pdf-lib']).toBeDefined()
    })
  })

  describe('package.json scripts', () => {
    it('exposes test:coverage', () => {
      expect(pkg.scripts['test:coverage']).toMatch(/vitest.*coverage/)
    })
    it('exposes test:e2e', () => {
      expect(pkg.scripts['test:e2e']).toMatch(/playwright/)
    })
  })

  describe('vitest.config.ts', () => {
    const cfg = readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8')
    it('references a setup file', () => {
      expect(cfg).toMatch(/setupFiles/)
      expect(cfg).toMatch(/src\/__tests__\/setup/)
    })
    it('configures 80% line coverage threshold', () => {
      expect(cfg).toMatch(/coverage/)
      expect(cfg).toMatch(/lines:\s*80/)
    })
    it('scopes coverage include to src/lib', () => {
      expect(cfg).toMatch(/src\/lib/)
    })
  })

  describe('Playwright config', () => {
    const cfgPath = path.join(ROOT, 'playwright.config.ts')
    it('exists at repo root', () => {
      expect(existsSync(cfgPath)).toBe(true)
    })
    const cfg = existsSync(cfgPath) ? readFileSync(cfgPath, 'utf8') : ''
    it('points webServer at pnpm dev on port 3000', () => {
      expect(cfg).toMatch(/pnpm dev/)
      expect(cfg).toMatch(/3000/)
    })
    it('has a smoke spec', () => {
      expect(existsSync(path.join(ROOT, 'e2e/smoke.spec.ts'))).toBe(true)
    })
  })

  describe('Supabase test helpers', () => {
    const helperPath = path.join(ROOT, 'src/__tests__/helpers/supabase.ts')
    it('helper file exists', () => {
      expect(existsSync(helperPath)).toBe(true)
    })
    it('exports createTestUser, clientAs, truncateUserData', async () => {
      const mod = await import('./helpers/supabase')
      expect(typeof mod.createTestUser).toBe('function')
      expect(typeof mod.clientAs).toBe('function')
      expect(typeof mod.truncateUserData).toBe('function')
    })
  })

  describe('CI workflow', () => {
    const wfPath = path.join(ROOT, '.github/workflows/test.yml')
    it('exists', () => {
      expect(existsSync(wfPath)).toBe(true)
    })
    const wf = existsSync(wfPath) ? readFileSync(wfPath, 'utf8') : ''
    it('runs on push and pull_request', () => {
      expect(wf).toMatch(/push:/)
      expect(wf).toMatch(/pull_request:/)
    })
    it('runs lint, typecheck, vitest', () => {
      expect(wf).toMatch(/lint/)
      expect(wf).toMatch(/typecheck/)
      expect(wf).toMatch(/vitest|pnpm\s+test/)
    })
    it('runs playwright', () => {
      expect(wf).toMatch(/playwright/)
    })
  })
})
