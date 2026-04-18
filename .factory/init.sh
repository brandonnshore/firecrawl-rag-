#!/bin/bash
# Idempotent environment setup. Safe to re-run.
# Does NOT start services (those live in services.yaml).
# Extended 2026-04-18 for prod-saas mission.

set -e

cd "$(dirname "$0")/.."

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

say()  { echo -e "${GREEN}[init]${NC} $1"; }
warn() { echo -e "${YELLOW}[init]${NC} $1"; }

# 1. Required CLIs (warn, don't die — some are per-milestone)
command -v pnpm >/dev/null 2>&1 || { echo "pnpm not found. Install: npm i -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || warn "docker not found — Supabase local and stripe-mock require Docker"
command -v supabase >/dev/null 2>&1 || warn "supabase CLI not found — needed from M1. Install: brew install supabase/tap/supabase"

# 2. Root dependencies
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  say "Installing root dependencies…"
  pnpm install
fi

# 3. Widget dependencies
if [ -d "widget" ] && [ -f "widget/package.json" ]; then
  if [ ! -d "widget/node_modules" ] || [ "widget/package.json" -nt "widget/node_modules/.package-lock.json" ]; then
    say "Installing widget dependencies…"
    (cd widget && pnpm install)
  fi
fi

# 4. .env.local
if [ ! -f ".env.local" ]; then
  if [ -f ".env.example" ]; then
    warn ".env.local missing — copying from .env.example (fill in keys before running dev)"
    cp .env.example .env.local
  else
    echo "ERROR: .env.local and .env.example both missing. Create .env.local manually." >&2
    exit 1
  fi
fi

# 5. Local Redis (M0 feature, still used for rate limit dev convenience)
if command -v redis-cli >/dev/null 2>&1; then
  if ! redis-cli -p 6379 ping > /dev/null 2>&1; then
    warn "Redis not running on port 6379 — local rate limiting may fail"
  fi
else
  warn "redis-cli not found — skip Redis check"
fi

# 6. Supabase local stack (M1+)
if command -v supabase >/dev/null 2>&1; then
  if ! supabase status >/dev/null 2>&1; then
    warn "Supabase local stack not running. Start with: supabase start"
  else
    say "Supabase local stack running"
  fi
fi

# 7. Playwright browsers (M1+, auto-install if @playwright/test is in deps)
if [ -f "node_modules/@playwright/test/package.json" ]; then
  if ! pnpm exec playwright --version >/dev/null 2>&1; then
    say "Installing Playwright browsers…"
    pnpm exec playwright install --with-deps chromium
  fi
fi

# 8. Mission artifact directories (idempotent)
mkdir -p docs/mission/handoffs .factory/library .factory/research .factory/validation

say "Init complete."
