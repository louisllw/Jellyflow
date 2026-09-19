# Jellyflow

A redesigned, flowing frontend for [Jellyfin](https://jellyfin.org) — dark, quiet, and built to let your library do the talking. One tiny static image, no database, no backend: point it at your existing Jellyfin instance and play.

## How it works

Jellyflow is a **pure client-side app**. On first run it asks for your server URL, username and password, then:

1. `POST /Users/AuthenticateByName` authenticates directly with your Jellyfin server
2. The password is discarded after sign-in; the resulting session token is stored in that browser's `localStorage`
3. All metadata, posters, and streams are fetched directly from your server over its public API

Because everything runs in your browser, the image ships **zero server-side code** — the container only serves the static bundle.

### Your server must allow cross-origin requests

Jellyflow talks to your instance from a *different origin*, so your server needs to permit CORS. **Jellyfin's default installation is fine** — the stock config sends `Access-Control-Allow-Origin: *` and Jellyflow has been verified against a live public instance. If your server sits behind a reverse proxy, make sure it forwards (or sets) the `Access-Control-Allow-Origin` and preflight headers.

## Run it

### Docker (recommended)

```sh
# Build locally, then run on any free port
docker build -t jellyflow .
docker run -d --name jellyflow -p 8080:8080 jellyflow
```

Open <http://localhost:8080>, enter your server details on the connect screen (e.g. `https://jellyfin.example.com`), and you're in.

### Docker Compose

```sh
# optional: prefill the server URL on the connect screen
#   JELLYFIN_URL=https://jellyfin.example.com
docker compose up -d
```

Then open <http://localhost:8080> — the connect screen arrives with your URL already in place.

### Build from source

```sh
docker build -t jellyflow .
docker run -d -p 8080:8080 jellyflow
```

## Features

- **Connect screen** — sign in against any Jellyfin instance; the session is kept in your browser only
- **Home** — a breathing hero for the night's pick, then shelves: *Continue watching* (with progress rings), *Up next*, *New in your library*
- **Browse** — the whole library as a wall, filter by type (films / series / episodes / music / video), sort by newest / A–Z / year / rating, paginated
- **Live TV** — a six-hour channel guide with programme details, channel favourites, one-off and series recording controls, a recordings library, and direct channel playback
- **Detail** — synopsis, specs (year, length, rating, status, genres), cast, and for series: expandable season/episode blocks with per-episode progress
- **Player** — full-screen hls.js playback of the adaptive (`.m3u8`) stream: play/pause, seek bar, ±10 s, volume/mute, keyboard shortcuts (space, `k`, `j`/`l`, `m`, esc), resume where you left off, and progress reported back to Jellyfin as you watch (marks played at ≥ 90 %)
- **Search** — the top bar is always listening; type and results stream in
- **Settings** — reconnect with new credentials or sign out; the connection details are shown in full
- Fully responsive down to phone width; honours `prefers-reduced-motion`

## Development

```sh
npm install
npm run dev          # Vite dev server
```

Copy `.env.example` to `.env` only when using Docker Compose. Local `.env` files, dependencies, and generated builds are excluded from Git.

## What's in the image

| Layer | Size |
|---|---|
| App bundle (JS + CSS, gzipped) | ~ 256 kB |
| nginx:1.27-alpine base | ~ 12 MB |

Long-lived immutable caching on fingerprinted assets, SPA deep-link fallback, a built-in healthcheck, validated runtime configuration, and restrictive browser security headers. No ports are exposed besides the one you map.
