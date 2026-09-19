# Jellyflow

[![CI](https://github.com/louisllw/Jellyflow/actions/workflows/ci.yml/badge.svg)](https://github.com/louisllw/Jellyflow/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/louisllw/Jellyflow?include_prereleases)](https://github.com/louisllw/Jellyflow/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-7c5cff.svg)](LICENSE)

A redesigned, flowing web client for [Jellyfin](https://jellyfin.org): dark, responsive and built to let your library do the talking.

> **Beta software:** Jellyflow is an independent community project. It is not affiliated with, maintained by, or endorsed by the Jellyfin project. Keep a standard Jellyfin client available while testing.

## Run it

Jellyflow has no backend or database. It connects directly from your browser to a Jellyfin server you control.

```sh
docker run -d \
  --name jellyflow \
  -p 8080:8080 \
  -e JELLYFIN_URL=https://jellyfin.example.com \
  ghcr.io/louisllw/jellyflow:latest
```

Open <http://localhost:8080>. `JELLYFIN_URL` only prefills the connect screen and may be omitted; no Jellyfin hostname is hard-coded into the image.

Or use the included Compose file:

```sh
cp .env.example .env
docker compose up -d
```

Both `linux/amd64` and `linux/arm64` images are published, covering common servers and Apple Silicon Macs.

## Features

- Home shelves for continue watching, up next and new additions, with a rotating library hero.
- Full-library browsing, filtering, sorting, pagination and instant search.
- Movie and series details with redesigned seasons, episodes, cast and watch progress.
- Live TV guide, programme details, channel favourites, recording controls and recordings library.
- Responsive HLS player with resume, seek, volume, mobile controls, keyboard shortcuts and progress reporting.
- Runtime-configurable server connection, responsive navigation and reduced-motion support.

## Known beta limitations

- Playback currently needs broader capability-aware negotiation and codec coverage.
- Automatic next episode and a playback queue are not implemented.
- General favourites and manual watched/unwatched controls are incomplete.
- Music views, casting, SyncPlay and downloads are incomplete.
- Jellyflow must be allowed by your Jellyfin CORS configuration. An HTTPS Jellyflow page also requires an HTTPS Jellyfin endpoint.

See the [roadmap](ROADMAP.md) and [open issues](https://github.com/louisllw/Jellyflow/issues) for planned work.

## How authentication works

1. Jellyflow sends the sign-in request directly to your Jellyfin server.
2. The password is discarded after sign-in.
3. Jellyfin's session token is stored in that browser's `localStorage` and is removed when you sign out.

The container serves static files only. Treat any device with an active session as signed in, use HTTPS outside a trusted local network, and never paste tokens into bug reports.

## Development

Node.js 22 is recommended.

```sh
npm ci
npm run dev
```

Build and check the project with:

```sh
npm audit --audit-level=high
npm run build
docker build -t jellyflow:test .
```

The production container runs nginx as an unprivileged user, validates runtime configuration and sends restrictive security headers. See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Project transparency

Development has included substantial AI-assisted implementation and review. Maintainers remain responsible for accepting changes, running checks and documenting limitations; contributors are asked to disclose substantial AI-assisted changes for appropriate review.

## License

Jellyflow is available under the [MIT License](LICENSE).
