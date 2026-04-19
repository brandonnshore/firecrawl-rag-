import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// M8F7 ci-github-actions — asserts the workflow file exists with the
// required jobs and triggers. VAL-HARD-011.

const WORKFLOW_PATH = resolve(
  process.cwd(),
  '.github',
  'workflows',
  'test.yml'
)

describe('CI workflow (M8F7 / VAL-HARD-011)', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8')

  it('exists and is non-empty', () => {
    expect(yaml.length).toBeGreaterThan(100)
  })

  it('triggers on pull_request', () => {
    expect(yaml).toMatch(/^\s*pull_request\s*:/m)
  })

  it('triggers on push to main', () => {
    expect(yaml).toMatch(/push\s*:\s*\n\s*branches\s*:\s*\[\s*main\s*\]/m)
  })

  it('has a static job running lint + typecheck', () => {
    expect(yaml).toMatch(/static\s*:\s*\n\s*name:\s*lint \+ typecheck/m)
    expect(yaml).toMatch(/pnpm lint/)
    expect(yaml).toMatch(/pnpm typecheck/)
  })

  it('has a unit job running vitest with coverage', () => {
    expect(yaml).toMatch(/unit\s*:\s*\n\s*name:\s*vitest \+ coverage/m)
    expect(yaml).toMatch(/pnpm test:coverage/)
  })

  it('has an e2e job running Playwright', () => {
    expect(yaml).toMatch(/e2e\s*:\s*\n\s*name:\s*playwright/m)
    expect(yaml).toMatch(/playwright install/)
    expect(yaml).toMatch(/pnpm test:e2e/)
  })

  it('uploads a coverage report to codecov', () => {
    expect(yaml).toContain('codecov/codecov-action')
  })

  it('uploads Playwright report as an artifact on failure', () => {
    expect(yaml).toContain('actions/upload-artifact')
    expect(yaml).toMatch(/name:\s*playwright-report/)
  })

  it('uses concurrency cancellation so stacked pushes do not pile up', () => {
    expect(yaml).toMatch(/cancel-in-progress:\s*true/)
  })

  it('freezes pnpm deps (frozen-lockfile)', () => {
    expect(yaml).toMatch(/pnpm install --frozen-lockfile/)
  })
})
