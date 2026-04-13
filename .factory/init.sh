#!/bin/bash
set -e

cd /Users/brandonshore/firecrawl-rag-

# Install dependencies if node_modules doesn't exist or package.json changed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

# Install widget dependencies if widget exists
if [ -d "widget" ] && [ -f "widget/package.json" ]; then
  if [ ! -d "widget/node_modules" ] || [ "widget/package.json" -nt "widget/node_modules/.package-lock.json" ]; then
    echo "Installing widget dependencies..."
    cd widget && pnpm install && cd ..
  fi
fi

# Ensure Redis is running
if ! redis-cli -p 6379 ping > /dev/null 2>&1; then
  echo "Warning: Redis not running on port 6379. Rate limiting will not work."
fi

# Verify .env.local exists
if [ ! -f ".env.local" ]; then
  echo "ERROR: .env.local not found. Copy from .env.example and fill in values."
  exit 1
fi

echo "Init complete."
