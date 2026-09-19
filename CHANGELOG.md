# Changelog

## 0.1.0-beta.1 — 2026-09-19

The first public beta of Jellyflow: an independent, responsive web client for an existing Jellyfin server.

### Highlights

- Home, browse, search and detailed movie and series views.
- Redesigned season and episode browsing.
- Live TV guide, programme information, channel favourites and recording controls.
- Responsive video player with progress reporting and resume support.
- Runtime-configurable Jellyfin address with no server hostname built into the image.
- Hardened non-root container, restrictive browser headers and automated dependency checks.

### Known limitations

- Playback negotiation and codec selection need broader device coverage.
- There is no automatic next-episode flow or playback queue yet.
- General favourites and manual watched controls are incomplete.
- Music, casting, SyncPlay and downloads are not complete.
- A reverse proxy may need CORS configuration, and HTTPS pages require an HTTPS Jellyfin endpoint.

This is beta software. Keep your normal Jellyfin clients available while testing and report reproducible issues without including credentials or private library information.
