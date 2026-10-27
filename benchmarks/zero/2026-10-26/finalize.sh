#!/bin/sh
set -eu
cd "$(dirname "$0")"
export PATH="${NODE24_BIN:-$HOME/.nvm/versions/node/v24.22.1/bin}:$PATH"
python3 summarize.py
python3 verify_results.py
