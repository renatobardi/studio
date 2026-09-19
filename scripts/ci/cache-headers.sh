#!/usr/bin/env bash
# Issue #203: after a deploy, a page opened before it only learns there is a
# new version when the browser fetches sw.js again — and a sw.js (or
# index.html) served with no Cache-Control is left to the browser's heuristic
# freshness, which can hold the old one. The shell must always be revalidated;
# the hashed assets never change and can be kept.
#
# Asks the running stack (STUDIO_URL, default the local Compose stack through
# Caddy) — CI, CD's studio-test and Promote's studio-prd all run this.
set -euo pipefail

base="${STUDIO_URL:-http://localhost}"
failed=0

# No -f: a failing path must still be reported below, not abort the whole check.
cache_control() {
  curl -sS -o /dev/null -D - "$base$1" | tr -d '\r' | sed -n 's/^[Cc]ache-[Cc]ontrol: //p' || true
}

expect() {
  local path="$1" wanted="$2" got
  got=$(cache_control "$path")
  if [[ "$got" != *"$wanted"* ]]; then
    echo "::error::$path is served with Cache-Control '$got', expected it to include '$wanted'" >&2
    failed=1
  else
    echo "cache headers OK: $path → $got"
  fi
}

for path in / /index.html /sw.js /manifest.webmanifest; do
  expect "$path" "no-cache"
done

# One of the build's own hashed assets, as index.html names it.
asset=$(curl -fsS "$base/index.html" | grep -o '/assets/[^"]*\.js' | head -1 || true)
if [[ -z "$asset" ]]; then
  echo "::error::index.html names no /assets/*.js to check" >&2
  failed=1
else
  expect "$asset" "immutable"
fi

# A missing asset is an error of the moment (a deploy or rollback in flight),
# never something for the browser to keep for a year.
missing=$(cache_control "/assets/cache-headers-check-missing.js")
if [[ "$missing" == *immutable* ]]; then
  echo "::error::a missing /assets/ file is served with Cache-Control '$missing' — a 404 must not be kept" >&2
  failed=1
else
  echo "cache headers OK: a missing asset is not kept"
fi

exit "$failed"
