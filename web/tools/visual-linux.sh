#!/usr/bin/env bash
# Flow 10 (e2e/visual.spec.ts) on Linux Chromium — the -linux baselines are drawn and checked
# only through here, locally and in CI (ci.yml, job `visual`), so both use the same image, the
# same Chromium and the same amd64 rasterisation. Arguments go to Playwright:
#   tools/visual-linux.sh                                  compare
#   tools/visual-linux.sh --update-snapshots -g "channel"  redraw (then check against docs/UI/reference)
#
# node_modules comes from a Docker volume, never from web/node_modules: the host's holds
# darwin-native binaries, and a Linux install must not overwrite them.
set -euo pipefail

web="$(cd "$(dirname "$0")/.." && pwd)"

# The image tag follows @playwright/test in bun.lock; bump both together.
exec docker run --rm --platform linux/amd64 --ipc=host \
  -e CI \
  -v "$web":/web \
  -v studio-web-linux-node-modules:/web/node_modules \
  -w /web \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -c 'npm install -g --silent bun@1.4.2 && bun install --frozen-lockfile --ignore-scripts && bun run test:visual "$@"' \
  bash "$@"
