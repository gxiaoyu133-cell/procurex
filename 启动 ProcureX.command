#!/bin/zsh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22.13 or later, then run this launcher again."
  read "?Press Enter to close."
  exit 1
fi
node scripts/serve-local.mjs
