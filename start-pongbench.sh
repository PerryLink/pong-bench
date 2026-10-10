#!/bin/sh
# PongBench on macOS and Linux: starts the app at http://127.0.0.1:8800 and opens it. Ctrl+C stops it.
#   ./start-pongbench.sh                 starts with a scripted player; pick your endpoint in the Bench tab
#   ./start-pongbench.sh typesafe-jev    starts with a config from configs/
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "PongBench needs Node.js 18.17 or newer: https://nodejs.org"
  echo "  macOS: brew install node    Linux: nvm (https://github.com/nvm-sh/nvm) or your distribution's nodejs package"
  exit 1
fi
exec node bin/pongbench.js serve --config "${1:-mock-oracle}" --open
