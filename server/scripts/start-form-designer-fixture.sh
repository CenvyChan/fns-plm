#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4179}"
export PORT HOST="0.0.0.0" NODE_ENV="development"
export DATABASE_FILE="${DATABASE_FILE:-/tmp/plm-form-designer-fixture.sqlite}"
# Fixture-only encryption key: generate a fresh random value; never inherit credentials from the environment.
export APP_ENCRYPTION_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
cd "$ROOT"
npm run build
exec node dist/index.js
