# Changelog

## Unreleased

Bug fixes:

- Query-string authentication now uses Jellyfin 12's `ApiKey` parameter for WebSockets, images, subtitles, trickplay and media URLs. This restores socket and media authentication after Jellyfin 12 disabled the legacy lowercase `api_key` parameter.
- The SyncPlay socket no longer reconnects forever when its session token is dead (for example after server-side sign-out or a token cleared by an admin). Each reconnect now re-validates the token first; on a 401/403 it stops retrying and the app clears the local session with the "Your session expired — sign in again." prompt instead of spamming the server with an unauthenticated `/socket` request every few seconds.
- `connectSocket` also refuses to start without a token, and an unparseable server URL no longer throws out of the reconnect path.
- Added Node regression coverage for the socket retry/stop behaviour.

## 0.1.0-beta.10 — 2026-09-20

Features and fixes:

- Auto quality now follows measured connection throughput and buffered playback, stepping through 360p, 480p, 720p and 1080p with conservative upgrade thresholds and a cooldown to prevent quality bouncing. Jellyfin/hls.js rendition switching remains seamless where the server provides a useful adaptive ladder.
- Changing quality now carries the current timestamp across the media-source reload instead of restarting the video from the beginning; manually selected qualities remain fixed rather than adaptive.
- Auto now keeps low-bitrate, browser-compatible sources on Direct Play when measured connection headroom is ample, then promotes repeated-stalling playback to adaptive HLS. Quality reloads preserve explicit pause intent and remembered audio/subtitle language choices.
- Jellyfin playback sessions now begin after negotiation with the real play method and `PlaySessionId`, and each superseded quality/transcode session is explicitly stopped instead of waiting for server cleanup.
- Playback failures now recover through Retry, Try lower quality and Play original actions, reset transient network failures after successful fragments, use bounded backoff, and automatically retry after connectivity returns.
- Added buffered-range rendering, Jellyfin trickplay thumbnail and chapter previews while scrubbing, Media Session lock-screen controls, screen wake lock during active playback, keyboard focus containment, and remembered subtitle size, background and timing controls.
- Added Node regression coverage for adaptive-quality hysteresis, quality recovery, HLS URL parameters, session payloads, requested trickplay metadata and tile URLs.
- Added a Jellyfin-style next-episode flow: episode playback shows an Up Next prompt during the final 30 seconds, advances automatically at the end, and continues across season boundaries.
- Episode pages now link back to the parent show, expose previous and next episodes, open the current season in place, and provide a direct route to every season.
- Search now returns only top-level TV shows, movies and live TV channels, with dedicated filters for each; individual seasons and incomplete search-hint records no longer appear as results.
- Fixed clearing the shared search field leaving the previous URL query active, stale search responses replacing newer ones, player autoplay running state changes during React render, and failed season requests loading forever.
- User-data library requests are now explicitly scoped to the signed-in Jellyfin user.
- Episode details now follow Jellyfin's media flow more closely: the show/season hierarchy and playback neighbours sit beside the primary action, useful air-date/rating/video/audio facts are visible, and an in-place season selector drives a horizontally scrollable episode rail positioned around the current episode.
- Mobile playback now pins the video to the full player bounds with aspect-fit sizing in inline and fullscreen modes, preventing non-native aspect ratios from being enlarged and cropped.

## 0.1.0-beta.9 — 2026-09-19

Bug fixes:

- Resume playback now waits until the browser has a seekable media timeline, verifies that the saved position was applied, and retries when a browser silently resets an early seek. Pending progress reports also retain the last real Jellyfin position instead of briefly reporting zero while resume is still being established.
- Closing the player now preserves its final playback position even after the media source has been torn down, so the cleanup request cannot lose the current watch time.
- Leaving fullscreen keeps the same video and timeline playing across standard browser and iOS native-fullscreen transitions, while still respecting an explicit user pause and avoiding duplicate-event pause/resume flicker.
- Continue Watching progress rings now read Jellyfin's `PlaybackPositionTicks` field.

## 0.1.0-beta.8 — 2026-09-19

Bug fixes:

- Fixed resume position getting silently overwritten by closing the player after only briefly watching (including just opening a video to test something). `Sessions/Playing/Stopped`, added in 0.1.0-beta.5 to properly close out a session on exit, reported the current position unconditionally — with no minimum-watched guard like the progress-reporting and mark-played calls right next to it already have — so it could reset a real, further-along saved resume position back to wherever playback happened to be at close. Session cleanup itself still always runs; only the reported position is now gated the same way the rest of this function already was.
- The previous iOS fullscreen-exit fix resisted *every* pause for a full second after leaving fullscreen, which could visibly fight iOS's own transition (repeated pause/resume flicker) instead of cleanly correcting it. It now catches the pause once and stops, rather than repeatedly re-asserting play.

## 0.1.0-beta.7 — 2026-09-19

Bug fixes:

- The previous fix for iOS Safari pausing on its own when leaving native fullscreen didn't hold: it re-played once after a short guessed delay, but iOS's own pause could still land *after* that check and silently undo it a moment later (playback resumed for an instant, then stopped again). It now actively resists any non-user-initiated pause for a short window after leaving fullscreen, instead of checking once at a guessed time.

## 0.1.0-beta.6 — 2026-09-19

Bug fixes:

- Fixed direct-played video failing to load, or silently ignoring resume/seek, on cross-origin Jellyfin servers (a public server address, not proxied through Jellyflow's own nginx). The previous release added `crossorigin="anonymous"` to the `<video>` element to support subtitle tracks, but that also applies to the main video fetch — and browsers require the media server to send CORS headers once that's set, which Jellyfin's plain streaming endpoints don't do by default. Reverted, since a working video matters more than working captions: this is a real trade-off, not a free fix, and cross-origin direct-play subtitles are a known limitation for unproxied servers until we have a better answer (confirmed both directions by testing against real CORS/no-CORS servers).
- Fixed the seek bar not responding to a drag on touch devices — it only had a tap handler, so a drag fell through to the browser's own touch handling instead: panning the page, or on a fast drag, triggering swipe-to-go-back navigation. It now uses Pointer Events with `touch-action: none` to capture the gesture itself, tracks the specific pointer so a second touch on the bar mid-drag can't hijack it, discards (rather than commits) an OS-cancelled gesture, and keeps the control bar from auto-hiding mid-drag.
- iOS Safari often pauses on its own when leaving its native fullscreen video player, even when returning to inline playback rather than being dismissed. Playback now resumes automatically if it was still meant to be playing — tracked by explicit user intent (did *you* pause it?) rather than guessing from a fixed delay, which could still race a slow OS pause or override a pause you made in that window.

## 0.1.0-beta.5 — 2026-09-19

Features:

- Jellyflow is now installable as a PWA with standalone display metadata and platform-appropriate icons. Its service worker caches only the application shell; runtime configuration, Jellyfin APIs, artwork, media and authentication data remain network-only.

Bug fixes and refinements:

- Playback no longer transcodes every video to H264/AAC by default. The player now asks Jellyfin (via `PlaybackInfo`/`DeviceProfile` negotiation, built from live codec-support probes) whether this browser can play the source file as-is, and only falls back to a server-side transcode when it actually can't — keeping original quality and codecs (HEVC, VP9, AV1…) whenever the browser supports them, and cutting server transcoding load for files that were already compatible.
- Playback sessions are now closed out with the server on exit (`Sessions/Playing/Stopped`, carrying the negotiated `PlaySessionId`), instead of leaving an active transcode job to expire on its own timeout.
- Subtitles and multi-track audio now work during direct play, not just when the server is transcoding to HLS — subtitle tracks are added from the item's own subtitle streams, and audio-track switching uses the browser's native track APIs.
- Fixed exiting fullscreen (Escape, or the browser's own "press Esc to exit" affordance) closing the whole player instead of just leaving fullscreen — the browser already clears fullscreen state before that same keypress reaches our own key handler, and the close logic didn't know to ignore it.
- The service worker's shell precache no longer fails atomically: a single missing/flaky asset used to abort install for the whole cache; each file is now cached independently.
- Service worker registration failures are now logged instead of silently discarded.

## 0.1.0-beta.4 — 2026-09-19

Build fix:

- Build the architecture-independent frontend on the native CI runner so the ARM64 image no longer runs Node under QEMU.

## 0.1.0-beta.3 — 2026-09-19

Bug fixes and refinements:

- A configured `JELLYFIN_URL` is now reached through Jellyflow's same-origin nginx proxy, allowing Docker service names and private container-network addresses while retaining direct public-server sign-in when the variable is omitted.

## 0.1.0-beta.2 — 2026-09-19

Bug fixes and refinements:

- The detail page now works for series: "Continue the series" resolves the next unwatched episode through Jellyfin's Next Up API, the backdrop image uses the returned tag list, and item requests include the active user for resume positions.
- Fix an autoplay loop: closing the player no longer immediately re-opens it via the `?play=1` URL parameter.
- The library browse page now honors the `?type=` URL parameter, so the Home page's category tiles open the correct room, and the shared search field stays in sync with the URL.
- Switching servers from Settings now swaps the live session in place instead of a hard page reload.
- Removed dead API client methods that pointed at non-existent Jellyfin endpoints (`/NextUp`, `/LatestMedia`).
- Hardened the session layer: the saved session no longer mutates React state in place, and saving it no longer throws when browser storage is unavailable.
- Smoother player: progress UI re-renders are limited to displayed-second changes while playing.
- `JELLYFIN_URL` now pins a deployment to that server: the login page only asks for credentials, stale sessions for another server are ignored, and server switching is hidden.

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
