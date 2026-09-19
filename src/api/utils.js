// Small shared helpers — formatting and item-type reasoning.

export function fmtRuntime(ms) {
  if (!ms || ms <= 0) return "";
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Jellyfin expresses runtimes in ticks (10^-7 s); convert then format. */
export function fmtRuntimeTicks(ticks) {
  return fmtRuntime(ticks / 10000);
}

export function fmtClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}

// Jellyfin ticks are 100ns units: 10,000,000 ticks = 1 second.
export function ticksToSeconds(t) {
  return t ? t / 10_000_000 : 0;
}

export function secondsToTicks(s) {
  return Math.round(s * 10_000_000);
}

export function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

const TYPE_LABEL = {
  Movie: "Film",
  Series: "Series",
  BoxSet: "Series",
  Season: "Season",
  Episode: "Episode",
  Video: "Video",
  Audio: "Track",
  MusicAlbum: "Album",
  Artist: "Artist",
  MusicVideo: "Music video",
  Person: "Person",
  Photo: "Photo",
  Playlist: "Playlist",
  TvChannel: "Live TV",
};

export function typeLabel(t) {
  return TYPE_LABEL[t] || t || "Item";
}

// Types the player can actually handle (files live on the server).
const PLAYABLE_TYPES = new Set(["Movie", "Episode", "Video", "Audio", "MusicVideo", "TvChannel"]);

export function looksPlayable(item) {
  return Boolean(item && PLAYABLE_TYPES.has(item.Type));
}

export function isAudioOnly(item) {
  return Boolean(item && item.Type === "Audio");
}

// Live TV channels have no fixed duration or resumable position.
export function isLiveTv(item) {
  return Boolean(item && item.Type === "TvChannel");
}

// Landscape vs portrait poster, from the item's own image aspect ratio.
export function posterRatio(item) {
  const a = item && item.PrimaryImageAspectRatio;
  if (a === "16/9" || a === "4/3" || a === "21/9" || a === "2/1" || a === "1/1") return "landscape";
  return "portrait";
}
