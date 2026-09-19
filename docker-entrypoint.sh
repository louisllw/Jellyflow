#!/bin/sh
# Writes the JELLYFIN_URL env var into a small runtime-config file the SPA
# reads on load — the only way to pass container env into a static bundle.
set -e

jellyfin_url=${JELLYFIN_URL:-}

# This value is written into JavaScript, so accept URLs only and reject every
# character that could terminate the string or create executable source.
if [ -n "$jellyfin_url" ] && ! printf '%s' "$jellyfin_url" | grep -Eq '^https?://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$'; then
  echo "JELLYFIN_URL must be an http(s) URL without spaces or quotes." >&2
  exit 1
fi

printf 'window.JELLYFIN_SERVER_URL = "%s";\n' "$jellyfin_url" \
  > /usr/share/nginx/html/env-config.js

exec "$@"
