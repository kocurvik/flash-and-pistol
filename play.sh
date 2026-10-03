#!/bin/sh
# Starts the Flash and Pistol server and opens the game in your browser.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org (LTS), then run this again."
  exit 1
fi
exec node server.js --open
