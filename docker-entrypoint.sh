#!/bin/sh
# Writes the JELLYFIN_URL env var into a small runtime-config file the SPA
# reads on load — the only way to pass container env into a static bundle.
set -e

jellyfin_url=${JELLYFIN_URL:-}
proxy_config=/etc/nginx/jellyfin-proxy.conf

# The value is inserted into generated JavaScript and nginx configuration.
# Accept an http(s) origin with an optional base path, while rejecting query
# strings, fragments, credentials, whitespace, quotes and config delimiters.
single_line_url=$(printf '%s' "$jellyfin_url" | tr -d '\r\n')
if [ "$single_line_url" != "$jellyfin_url" ] || { [ -n "$jellyfin_url" ] && ! printf '%s' "$jellyfin_url" | grep -Eq '^https?://(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9._~-]+)(:[0-9]{1,5})?(/[A-Za-z0-9._~!&()*+,=:@%/-]*)?$'; }; then
  echo "JELLYFIN_URL must be an http(s) URL without credentials, a query string or fragment." >&2
  exit 1
fi

if [ -n "$jellyfin_url" ]; then
  while [ "${jellyfin_url%/}" != "$jellyfin_url" ]; do
    jellyfin_url=${jellyfin_url%/}
  done

  jellyfin_origin=$(printf '%s' "$jellyfin_url" | sed -E 's#^(https?://[^/]+).*$#\1#')
  jellyfin_path=${jellyfin_url#"$jellyfin_origin"}
  jellyfin_name=${jellyfin_origin#*://}
  case "$jellyfin_name" in
    \[*\]*) jellyfin_tls_name=${jellyfin_name#\[}; jellyfin_tls_name=${jellyfin_tls_name%%\]*} ;;
    *) jellyfin_tls_name=${jellyfin_name%%:*} ;;
  esac
  dns_resolver=$(awk '/^nameserver[[:space:]]+/ { print $2; exit }' /etc/resolv.conf)
  if [ -z "$dns_resolver" ] || ! printf '%s' "$dns_resolver" | grep -Eq '^[0-9A-Fa-f:.]+$'; then
    echo "Could not determine a safe DNS resolver for the Jellyfin proxy." >&2
    exit 1
  fi
  case "$dns_resolver" in
    *:*) dns_resolver="[$dns_resolver]" ;;
  esac

  # A variable proxy target makes nginx re-resolve Docker DNS if the Jellyfin
  # container is recreated with a different address. The rewrite strips the
  # browser-facing /jellyfin prefix and preserves an upstream base path.
  printf 'location = /jellyfin { return 308 /jellyfin/; }
location /jellyfin/ {
  resolver %s valid=30s ipv6=off;
  set $jellyfin_upstream "%s";
  rewrite ^/jellyfin/(.*)$ "%s/$1" break;
  proxy_pass $jellyfin_upstream;
  proxy_http_version 1.1;
  proxy_set_header Host $proxy_host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Protocol $scheme;
  proxy_set_header X-Forwarded-Host $http_host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection $connection_upgrade;
  proxy_ssl_server_name on;
  proxy_ssl_name "%s";
  proxy_ssl_verify on;
  proxy_ssl_verify_depth 5;
  proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
  proxy_buffering off;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
  access_log off;
}
' "$dns_resolver" "$jellyfin_origin" "$jellyfin_path" "$jellyfin_tls_name" > "$proxy_config"

  printf 'window.JELLYFIN_SERVER_URL = window.location.origin + "/jellyfin";\nwindow.JELLYFIN_SERVER_NAME = "%s";\n' \
    "$jellyfin_name" > /usr/share/nginx/html/env-config.js
else
  : > "$proxy_config"
  printf 'window.JELLYFIN_SERVER_URL = "";\nwindow.JELLYFIN_SERVER_NAME = "";\n' \
    > /usr/share/nginx/html/env-config.js
fi

exec "$@"
