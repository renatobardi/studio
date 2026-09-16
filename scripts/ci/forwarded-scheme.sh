#!/usr/bin/env bash
# Issue #54: in production TLS ends at the host's Nginx, which tells Caddy
# `X-Forwarded-Proto: https`. The api must see that scheme: NIP-98 compares
# the signed `u` tag with request.url and NIP-42 the `relay` tag with the
# websocket URL, so an api that believes it is on http:// rejects every
# Nostr-authenticated call made over https://.
#
# Asks the running Compose stack, through Caddy, for a redirect — its
# Location is built from the scheme the api believes it was reached on.
set -euo pipefail

base="${STUDIO_URL:-http://localhost}"
location=$(curl -sS -o /dev/null -D - \
  -H 'Host: studio.example' -H 'X-Forwarded-Proto: https' \
  "$base/api/ready/" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p')

if [[ "$location" != https://studio.example/* ]]; then
  echo "::error::behind a TLS-terminating proxy the api built '$location', expected https://studio.example/..." >&2
  exit 1
fi
echo "forwarded scheme OK: $location"
