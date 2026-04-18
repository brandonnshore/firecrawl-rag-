#!/usr/bin/env bash
# Scans staged changes for common secret patterns.
# Exits 1 if any match is found, aborting the commit.
#
# Wired up as a git pre-commit hook via .githooks/pre-commit (the repo
# sets core.hooksPath = .githooks via `pnpm run prepare`).

set -eu

# Patterns that indicate real credentials. Kept intentionally narrow to
# avoid noise on docs/tests that legitimately mention, e.g. "sk_test".
PATTERNS=(
  # Stripe live keys
  'sk_live_[A-Za-z0-9]{16,}'
  'rk_live_[A-Za-z0-9]{16,}'
  # Stripe test secret keys (≥20 random chars after sk_test_)
  'sk_test_[A-Za-z0-9]{20,}'
  # Stripe webhook signing secret
  'whsec_[A-Za-z0-9]{20,}'
  # OpenAI
  'sk-[A-Za-z0-9]{20,}'
  # Generic PEM block
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'
  # AWS
  'AKIA[0-9A-Z]{16}'
  # Google API
  'AIza[0-9A-Za-z_-]{35}'
)

# Collect staged content (cached diff, additions only). Exclude files that
# legitimately document or test secret patterns — the scanner protects source,
# not pattern catalogs or handoff notes.
staged=$(git diff --cached --unified=0 --no-color \
  -- \
  ':!.env.example' \
  ':!package-lock.json' \
  ':!pnpm-lock.yaml' \
  ':!scripts/secret-scan.sh' \
  ':!src/__tests__/env-audit.test.ts' \
  ':!docs/mission/handoffs/*.json' \
  ':!docs/mission/**' \
  ':!README.md' \
  2>/dev/null | grep -E '^\+[^+]' || true)

if [[ -z "$staged" ]]; then
  exit 0
fi

hit=""
for pat in "${PATTERNS[@]}"; do
  found=$(printf '%s' "$staged" | grep -oE -- "$pat" || true)
  if [[ -n "$found" ]]; then
    hit+="  pattern: $pat"$'\n'
    hit+="  matches: $(printf '%s' "$found" | head -3)"$'\n'
  fi
done

if [[ -n "$hit" ]]; then
  echo "✗ secret-scan: staged changes contain likely credentials:" >&2
  echo "$hit" >&2
  echo "" >&2
  echo "Use an env var instead. Production secrets belong in the Vercel dashboard." >&2
  exit 1
fi

exit 0
