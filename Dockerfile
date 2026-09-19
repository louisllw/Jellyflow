# syntax=docker/dockerfile:1
#
# Jellyflow — a redesigned, flowing frontend for Jellyfin.
#
#   Stage 1: build the React app with Vite
#   Stage 2: serve the static bundle from a tiny nginx image
#
# The result is a single ~15 MB image anyone can run:
#
#   docker run -d -p 8080:8080 ghcr.io/yourname/jellyflow
#
# …then open http://localhost:8080 and point it at your Jellyfin server.

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build
# Drop the dev-only localStorage seeder so the shipped image stays clean
RUN rm -f dist/seed.html

FROM nginx:1.27-alpine
COPY nginx-main.conf /etc/nginx/nginx.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
    && chown -R nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://127.0.0.1:8080/ >/dev/null || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
