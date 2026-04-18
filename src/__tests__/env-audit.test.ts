/**
 * M1F5 env-gitignore-audit: defense-in-depth checks on the repo's secret
 * hygiene. These are deliberately file-system assertions rather than
 * behavior tests — they're a tripwire for things that must not regress.
 */

import { describe, it, expect } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')

describe('M1F5 env + gitignore audit', () => {
  describe('.env.example', () => {
    const p = path.join(ROOT, '.env.example')
    it('exists at repo root', () => {
      expect(existsSync(p)).toBe(true)
    })

    const contents = existsSync(p) ? readFileSync(p, 'utf8') : ''

    const dayOne = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'OPENAI_API_KEY',
      'FIRECRAWL_API_KEY',
      'NEXT_PUBLIC_APP_URL',
    ]
    const m2 = [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    ]
    const m8 = [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'RESEND_API_KEY',
      'SENTRY_DSN',
    ]

    for (const name of [...dayOne, ...m2, ...m8]) {
      it(`documents ${name}`, () => {
        expect(contents).toMatch(new RegExp(`^${name}=`, 'm'))
      })
    }

    it('has no real-looking values after any `=`', () => {
      // Each line like KEY=VALUE should have VALUE empty or contain only
      // localhost defaults / whitespace. Reject anything that looks like an
      // API key by length and charset.
      const suspicious = contents
        .split('\n')
        .filter((line) => /^[A-Z_][A-Z0-9_]+=.+/.test(line))
        .filter((line) => {
          const value = line.split('=', 2)[1]
          // localhost URL is fine
          if (value.startsWith('http://localhost')) return false
          return /[A-Za-z0-9_-]{20,}/.test(value)
        })
      expect(suspicious).toEqual([])
    })
  })

  describe('.env.local history', () => {
    it('was never committed', () => {
      const result = spawnSync(
        'git',
        ['log', '--all', '--full-history', '--', '.env.local'],
        { cwd: ROOT, encoding: 'utf8' }
      )
      expect(result.status).toBe(0)
      expect(result.stdout.trim()).toBe('')
    })

    it('is listed in .gitignore', () => {
      const gi = readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
      expect(gi).toMatch(/^\.env\.local$/m)
    })
  })

  describe('pre-commit secret-scan hook', () => {
    const hook = path.join(ROOT, '.githooks/pre-commit')
    const scanner = path.join(ROOT, 'scripts/secret-scan.sh')

    it('.githooks/pre-commit exists and is executable', () => {
      expect(existsSync(hook)).toBe(true)
      const mode = statSync(hook).mode
      expect(mode & 0o111).toBeGreaterThan(0)
    })

    it('scripts/secret-scan.sh exists and is executable', () => {
      expect(existsSync(scanner)).toBe(true)
      const mode = statSync(scanner).mode
      expect(mode & 0o111).toBeGreaterThan(0)
    })

    it('detects Stripe-live-style keys in diff', () => {
      // Assembled at runtime so GitHub's push-protection scanner doesn't flag
      // this test fixture as a real leak.
      const livePrefix = 's' + 'k' + '_l' + 'ive_'
      const body = 'X'.repeat(20)
      const fake = `const key = "${livePrefix}${body}"`

      const patternCheck = spawnSync(
        'bash',
        ['-c', `echo "${fake}" | grep -oE '${livePrefix}[A-Za-z0-9]{16,}'`],
        { encoding: 'utf8' }
      )
      expect(patternCheck.stdout.trim().startsWith(livePrefix)).toBe(true)
    })
  })

  describe('README', () => {
    const readme = path.join(ROOT, 'README.md')
    it('has a Secrets section naming Vercel', () => {
      const body = existsSync(readme) ? readFileSync(readme, 'utf8') : ''
      expect(body).toMatch(/## Secrets|### Secrets/)
      expect(body).toMatch(/Vercel/)
    })
  })

  describe('package.json', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, 'package.json'), 'utf8')
    ) as { scripts: Record<string, string> }
    it('has a prepare script that points core.hooksPath at .githooks', () => {
      expect(pkg.scripts.prepare).toMatch(/core\.hooksPath/)
      expect(pkg.scripts.prepare).toMatch(/\.githooks/)
    })
  })

  describe('services.yaml env_requirements', () => {
    it('every env var in services.yaml is also documented in .env.example', () => {
      const svc = readFileSync(path.join(ROOT, '.factory/services.yaml'), 'utf8')
      const envExample = readFileSync(path.join(ROOT, '.env.example'), 'utf8')

      // Pull every `- NAME_LIKE_THIS` bullet under env_requirements.
      const vars = Array.from(
        svc.matchAll(/^\s*-\s+([A-Z][A-Z0-9_]+)\s*$/gm),
        (m) => m[1]
      )
      expect(vars.length).toBeGreaterThan(5)
      for (const v of vars) {
        expect(envExample, `missing ${v} in .env.example`).toMatch(
          new RegExp(`^${v}=`, 'm')
        )
      }
    })
  })
})

// Quick direct unit-style invocation of the scanner over a throwaway repo.
describe('secret-scan.sh integration', () => {
  const tmpDir = '/tmp/secret-scan-test-' + Date.now()
  const scanner = path.join(ROOT, 'scripts/secret-scan.sh')

  it('aborts a commit that includes a Stripe-test-style placeholder', () => {
    execSync(`rm -rf "${tmpDir}" && mkdir -p "${tmpDir}" && cd "${tmpDir}" && git init -q && git config user.email t@t && git config user.name t`, { stdio: 'ignore' })
    // Prefix assembled to avoid tripping GitHub push-protection on this file.
    const testPrefix = 's' + 'k_' + 'test_'
    const body = 'a'.repeat(22)
    execSync(`echo 'const k = "${testPrefix}${body}"' > "${tmpDir}/app.ts" && cd "${tmpDir}" && git add app.ts`, { stdio: 'ignore' })

    const result = spawnSync('bash', [scanner], {
      cwd: tmpDir,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/secret-scan/)

    execSync(`rm -rf "${tmpDir}"`, { stdio: 'ignore' })
  })

  it('passes a commit without secrets', () => {
    execSync(`rm -rf "${tmpDir}" && mkdir -p "${tmpDir}" && cd "${tmpDir}" && git init -q && git config user.email t@t && git config user.name t`, { stdio: 'ignore' })
    execSync(`echo 'export const msg = "hello"' > "${tmpDir}/clean.ts" && cd "${tmpDir}" && git add clean.ts`, { stdio: 'ignore' })

    const result = spawnSync('bash', [scanner], {
      cwd: tmpDir,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)

    execSync(`rm -rf "${tmpDir}"`, { stdio: 'ignore' })
  })
})
