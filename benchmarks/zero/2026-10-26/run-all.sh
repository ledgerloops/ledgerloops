#!/bin/sh
set -eu
cd "$(dirname "$0")"
# Use Node 24.22.1; override this path on another host with an equivalent installation.
export PATH="${NODE24_BIN:-$HOME/.nvm/versions/node/v24.22.1/bin}:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/../../work/browsers"
python3 generate_fixture.py fixture
python3 with_lock.py npm ci --no-audit --no-fund
python3 with_lock.py node node_modules/playwright/cli.js install chromium
python3 with_lock.py node build.mjs
for model in typed record collection; do
 python3 with_lock.py env VARIANTS="$model" node run.mjs
done
sh finalize.sh
