// Jellyfin API client. User-entered public servers are contacted directly;
// container-configured servers are reached through Jellyflow's same-origin proxy.
//
// JSON calls use the X-Emby-Token header. Images and stream URLs use the
// `api_key` query parameter instead, because <img> tags and the hls.js XHR
// pipeline cannot set custom headers.

import { buildDeviceProfile } from "./deviceProfile.js";

const LS_CONFIG = "jellyflow.config.v1";
const LS_DEVICE = "jellyflow.device";
const LS_LAST_SERVER = "jellyflow.lastServer";

/* ---------------------------------- config --------------------------------- */

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(LS_CONFIG)) || null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  // Storage can be unavailable (private browsing, quota) — in that case the
  // session simply won't survive a reload; the in-memory client still works.
  try {
    localStorage.setItem(LS_CONFIG, JSON.stringify(cfg));
  } catch {}
}

export function clearConfig() {
  localStorage.removeItem(LS_CONFIG);
}

// Remembered independently of the signed-in session, so the address is
// still there to greet you after a sign-out — only credentials are cleared.
export function loadLastServer() {
  try {
    return localStorage.getItem(LS_LAST_SERVER) || "";
  } catch {
    return "";
  }
}

export function saveLastServer(url) {
  try {
    if (url) localStorage.setItem(LS_LAST_SERVER, url);
  } catch {}
}

export function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(LS_DEVICE);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(LS_DEVICE, id);
    }
  } catch {
    id = "jellyflow-" + Math.random().toString(36).slice(2);
  }
  return id;
}

export function normalizeServerUrl(input) {
  let url = String(input || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "http://" + url;
  return url;
}

export function runtimeServerUrl() {
  if (typeof window === "undefined") return "";
  return normalizeServerUrl(window.JELLYFIN_SERVER_URL || "");
}

export function runtimeServerName() {
  if (typeof window === "undefined") return "";
  return String(window.JELLYFIN_SERVER_NAME || "").trim();
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/* ---------------------------------- errors --------------------------------- */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* --------------------------------- plumbing -------------------------------- */

function qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    const values = Array.isArray(v) ? v : [v];
    values.forEach((value) => {
      if (value !== undefined && value !== null && value !== "") {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(value)}`);
      }
    });
  }
  return parts.length ? "?" + parts.join("&") : "";
}

async function raw(serverUrl, path, { method = "GET", body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(serverUrl + path, {
      method,
      headers: {
        ...headers,
        // Some servers 401 on a bare X-Emby-Token; the full Authorization
        // header (with the token embedded) is what actually authenticates.
        ...(token ? { Authorization: authHeader(getDeviceId(), token), "X-Emby-Token": token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      `Couldn't reach ${hostOf(serverUrl)}. Check the address and that the server is up.`,
      0,
    );
  }

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const msg = (data && (data.Message || data.ErrorMessage)) || null;
    // A 401 on an *authenticated* call means the token is dead. But the
    // login flow itself also surfaces 401 for genuine credential failure, so
    // callers that expect a credential failure (login) handle their own 401
    // and this generic message only ever applies to post-login calls.
    if (res.status === 401) {
      throw new ApiError("Your session expired — sign in again.", 401);
    }
    throw new ApiError(msg || `The server responded with status ${res.status}.`, res.status);
  }
  return { res, data };
}

/* ----------------------------------- auth ---------------------------------- */

function authHeader(deviceId, token) {
  let h = `MediaBrowser Client="Jellyflow", Device="Web Browser", DeviceId="${deviceId}", Version="1.0.0"`;
  if (token) h += `, Token="${token}"`;
  return h;
}

// For requests that can't be built through raw() — e.g. hls.js's own XHRs —
// but still need the same strict Authorization header some servers require.
export function mediaAuthHeader(token) {
  return authHeader(getDeviceId(), token);
}

// The endpoint the official Jellyfin web client uses to sign in:
//   POST /Users/AuthenticateByName → verifies credentials, returns a token.
export async function login(serverUrl, username, password) {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new ApiError("Enter your server address.", 0);
  if (!username || !password)
    throw new ApiError("Enter both a username and a password from that server.", 0);

  let data;
  try {
    const out = await raw(base, "/Users/AuthenticateByName", {
      method: "POST",
      body: { Username: username, Pw: password },
      headers: { Authorization: authHeader(getDeviceId()) },
    });
    data = out.data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      throw new ApiError(
        "That username and password don't match an account on that server.",
        e.status,
      );
    }
    throw e;
  }
  if (!data || !data.AccessToken || !data.User) {
    throw new ApiError("That username and password don't match an account on that server.", 401);
  }
  return { user: data.User, token: data.AccessToken };
}

export async function quickConnectAvailable(serverUrl) {
  const base = normalizeServerUrl(serverUrl);
  if (!base) return false;
  try {
    const { data } = await raw(base, "/QuickConnect/Enabled", {
      headers: { Authorization: authHeader(getDeviceId()) },
    });
    return data === true;
  } catch {
    return false;
  }
}

export async function initiateQuickConnect(serverUrl) {
  const base = normalizeServerUrl(serverUrl);
  const { data } = await raw(base, "/QuickConnect/Initiate", {
    method: "POST",
    headers: { Authorization: authHeader(getDeviceId()) },
  });
  return data;
}

export async function quickConnectStatus(serverUrl, secret) {
  const base = normalizeServerUrl(serverUrl);
  const { data } = await raw(base, `/QuickConnect/Connect${qs({ secret })}`, {
    headers: { Authorization: authHeader(getDeviceId()) },
  });
  return data;
}

export async function loginWithQuickConnect(serverUrl, secret) {
  const base = normalizeServerUrl(serverUrl);
  const { data } = await raw(base, "/Users/AuthenticateWithQuickConnect", {
    method: "POST",
    body: { Secret: secret },
    headers: { Authorization: authHeader(getDeviceId()) },
  });
  if (!data?.AccessToken || !data?.User) throw new ApiError("Quick Connect was not authorised.", 401);
  return { user: data.User, token: data.AccessToken };
}

// API keys aren't tied to one account, so we list the server's users and let
// the caller (UI) pick which profile to act as.
export async function listUsersWithApiKey(serverUrl, apiKey) {
  const base = normalizeServerUrl(serverUrl);
  if (!base) throw new ApiError("Enter your server address.", 0);
  if (!apiKey) throw new ApiError("Enter an API key.", 0);

  try {
    const { data } = await raw(base, "/Users", { token: apiKey });
    if (!Array.isArray(data) || !data.length) {
      throw new ApiError("That API key doesn't have access to any users.", 401);
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      throw new ApiError("That API key was rejected by the server.", e.status);
    }
    throw e;
  }
}

export function userAvatarUrl(serverUrl, apiKey, user) {
  if (!user || !user.Id || !user.PrimaryImageTag) return "";
  const base = normalizeServerUrl(serverUrl);
  return `${base}/Users/${user.Id}/Images/Primary?api_key=${encodeURIComponent(apiKey)}&quality=80&maxWidth=200`;
}

/* ------------------------------- the client ------------------------------- */

export class Jellyfin {
  constructor(cfg) {
    this.cfg = cfg;
    this._bitrateSample = null;
    this._socket = null;
    this._socketListeners = new Set();
    this._socketStopped = false;
    this.inSyncPlay = false;
    this.syncPlayQueue = [];
  }

  get serverUrl() {
    return this.cfg.serverUrl;
  }
  get token() {
    return this.cfg.token;
  }
  get userId() {
    return this.cfg.userId;
  }

  _req(path, { method = "GET", body } = {}) {
    return raw(this.serverUrl, path, { method, body, token: this.token }).then((r) => r.data);
  }

  _get(path, params) {
    return this._req(path + qs(params));
  }

  /* ------------------------------ discovery ------------------------------ */

  me() {
    return this._get(`/Users/${this.userId}`);
  }

  library() {
    return this._get(`/Users/${this.userId}/Library`);
  }

  home() {
    // Jellyfin has no single "/Home" endpoint — the official clients compose
    // the home screen from these three calls, so we do the same.
    return Promise.all([
      this._get(`/Users/${this.userId}/Items/Resume`, {
        Limit: 24,
        Fields: "PrimaryImageAspectRatio,BasicSyncInfo",
        MediaTypes: "Video",
      }),
      this._get("/Shows/NextUp", {
        UserId: this.userId,
        Limit: 24,
        Fields: "PrimaryImageAspectRatio,BasicSyncInfo",
      }),
      this._get(`/Users/${this.userId}/Items/Latest`, {
        Limit: 24,
        Fields: "PrimaryImageAspectRatio,BasicSyncInfo",
      }),
    ]).then(([continueWatching, nextUp, latest]) => ({
      ContinueWatching: continueWatching?.Items || [],
      NextUp: nextUp?.Items || [],
      Latest: Array.isArray(latest) ? latest : [],
    }));
  }

  items(params = {}) {
    return this._get("/Items", {
      UserId: this.userId,
      Recursive: true,
      Fields:
        "PrimaryImageAspectRatio,OriginalRuntimeTicks,ProductionYear,CommunityRating,Status,Genres",
      EnableUserData: true,
      ...params,
    });
  }

  item(id, extra = {}) {
    // Identify the user explicitly so the item DTO includes that user's
    // playback position. BackdropImageTags is part of the returned DTO.
    return this._get(`/Items/${id}`, {
      UserId: this.userId,
      Fields: "MediaSources,MediaStreams,Chapters,Trickplay",
      ...extra,
    });
  }

  async mediaSegments(itemId, includeSegmentTypes = ["Recap", "Intro", "Commercial", "Outro"]) {
    try {
      const result = await this._get(`/MediaSegments/${itemId}`, {
        includeSegmentTypes,
      });
      return result?.Items || [];
    } catch (error) {
      // Media Segments arrived in Jellyfin 10.10. Older servers simply do
      // not have the endpoint, so chapter metadata remains a safe fallback.
      if (error instanceof ApiError && error.status === 404) return [];
      throw error;
    }
  }

  async measureBitrate(size = 500_000) {
    const fresh = this._bitrateSample && Date.now() - this._bitrateSample.at < 60_000;
    if (fresh) return this._bitrateSample.bitsPerSecond;
    const started = performance.now();
    const response = await fetch(`${this.serverUrl}/Playback/BitrateTest${qs({ size })}`, {
      headers: {
        Authorization: authHeader(getDeviceId(), this.token),
        "X-Emby-Token": this.token,
      },
      cache: "no-store",
    });
    if (!response.ok) throw new ApiError(`The server bitrate test failed (${response.status}).`, response.status);
    const bytes = (await response.arrayBuffer()).byteLength;
    const elapsedSeconds = Math.max(0.001, (performance.now() - started) / 1000);
    const bitsPerSecond = Math.round((bytes * 8) / elapsedSeconds);
    this._bitrateSample = { at: Date.now(), bitsPerSecond };
    return bitsPerSecond;
  }

  // The next unwatched episodes of a series — the same data the official
  // client uses for "Next Up" on a series page. One call finds the episode
  // to start with when a whole series (rather than one file) is played.
  nextEpisodes(seriesId, params = {}) {
    return this._get("/Shows/NextUp", {
      UserId: this.userId,
      SeriesId: seriesId,
      Limit: 1,
      EnableUserData: true,
      Fields: "PrimaryImageAspectRatio,IndexNumber,ParentIndexNumber,SeriesName,SeasonName,Overview,MediaSources",
      ...params,
    });
  }

  seasons(seriesId) {
    return this._get(`/Shows/${seriesId}/Seasons`, {
      Fields: "PrimaryImageAspectRatio,IndexNumber,SeasonName,ChildCount,ProductionYear,Overview",
    });
  }

  episodes(seasonId, params = {}) {
    return this._get("/Items", {
      ParentId: seasonId,
      IncludeItemTypes: "Episode",
      Recursive: false,
      Fields:
        "PrimaryImageAspectRatio,IndexNumber,ParentIndexNumber,SeriesName,SeasonName,OriginalRuntimeTicks,ProductionYear,Overview,CommunityRating",
      EnableUserData: true,
      ...params,
    });
  }

  seriesEpisodes(seriesId, params = {}) {
    return this._get(`/Shows/${seriesId}/Episodes`, {
      UserId: this.userId,
      EnableUserData: true,
      Fields:
        "PrimaryImageAspectRatio,IndexNumber,ParentIndexNumber,ParentId,SeasonId,SeriesId,SeriesName,SeasonName,OriginalRuntimeTicks,ProductionYear,PremiereDate,Overview,CommunityRating,OfficialRating",
      ...params,
    });
  }

  // Search full, user-scoped library items rather than /Search/Hints. Hints
  // include seasons and people and only resemble BaseItemDto objects; feeding
  // them into media cards produced misleading season results and incomplete
  // detail links. Keeping this to top-level playable rooms also mirrors the
  // three filters in the search UI.
  search(term, { includeItemTypes = "Series,Movie,TvChannel", ...params } = {}) {
    return this.items({
      SearchTerm: term,
      IncludeItemTypes: includeItemTypes,
      ExcludeItemTypes: "Season,Episode",
      SortBy: "SortName",
      SortOrder: "Ascending",
      EnableTotalRecordCount: true,
      Limit: 48,
      ...params,
    });
  }

  suggestions(params = {}) {
    return this._get("/Items/Suggestions", {
      UserId: this.userId,
      Limit: 24,
      EnableTotalRecordCount: false,
      MediaType: "Video",
      Type: "Movie,Series",
      ...params,
    });
  }

  movieRecommendations(params = {}) {
    return this._get("/Movies/Recommendations", {
      UserId: this.userId,
      CategoryLimit: 4,
      ItemLimit: 12,
      ...params,
    });
  }

  similarItems(itemId, params = {}) {
    return this._get(`/Items/${itemId}/Similar`, {
      UserId: this.userId,
      Limit: 18,
      Fields: "PrimaryImageAspectRatio,ProductionYear,CommunityRating,Overview",
      ...params,
    });
  }

  specialFeatures(itemId) {
    return this._get(`/Items/${itemId}/SpecialFeatures`, { UserId: this.userId });
  }

  localTrailers(itemId) {
    return this._get(`/Items/${itemId}/LocalTrailers`, { UserId: this.userId });
  }

  themeMedia(itemId) {
    return Promise.all([
      this._get(`/Items/${itemId}/ThemeSongs`, { UserId: this.userId, InheritFromParent: true }),
      this._get(`/Items/${itemId}/ThemeVideos`, { UserId: this.userId, InheritFromParent: true }),
    ]).then(([songs, videos]) => ({ songs: songs?.Items || [], videos: videos?.Items || [] }));
  }

  lyrics(itemId) {
    return this._get(`/Audio/${itemId}/Lyrics`);
  }

  additionalParts(itemId) {
    return this._get(`/Videos/${itemId}/AdditionalParts`, { UserId: this.userId });
  }

  instantMix(itemId) {
    return this._get(`/Items/${itemId}/InstantMix`, {
      UserId: this.userId,
      Limit: 100,
      Fields: "PrimaryImageAspectRatio,MediaSources,MediaStreams",
    });
  }

  playlists(params = {}) {
    return this.items({ IncludeItemTypes: "Playlist", Recursive: true, ...params });
  }

  playlistItems(playlistId, params = {}) {
    return this._get(`/Playlists/${playlistId}/Items`, {
      UserId: this.userId,
      Fields: "PrimaryImageAspectRatio,MediaSources,MediaStreams",
      ...params,
    });
  }

  createPlaylist(name, itemIds = []) {
    return this._req(`/Playlists${qs({ Name: name, Ids: itemIds.join(","), UserId: this.userId })}`, { method: "POST" });
  }

  addPlaylistItems(playlistId, itemIds) {
    return this._req(`/Playlists/${playlistId}/Items${qs({ Ids: itemIds.join(","), UserId: this.userId })}`, { method: "POST" });
  }

  displayPreferences(id = "jellyflow") {
    return this._get(`/DisplayPreferences/${id}`, { UserId: this.userId, Client: "Jellyflow" });
  }

  endpointInfo() {
    return this._get("/System/Endpoint");
  }

  saveDisplayPreferences(preferences, id = "jellyflow") {
    return this._req(`/DisplayPreferences/${id}${qs({ UserId: this.userId, Client: "Jellyflow" })}`, {
      method: "POST",
      body: preferences,
    });
  }

  /* ------------------------------- live tv ------------------------------- */

  liveTvChannels(params = {}) {
    return this._get("/LiveTv/Channels", {
      UserId: this.userId,
      EnableFavoriteSorting: true,
      AddCurrentProgram: true,
      EnableUserData: true,
      Fields: "PrimaryImageAspectRatio,ChannelInfo,CurrentProgram",
      ...params,
    });
  }

  liveTvPrograms(params = {}) {
    return this._get("/LiveTv/Programs", {
      UserId: this.userId,
      EnableTotalRecordCount: false,
      Fields: "Overview,PrimaryImageAspectRatio,ChannelInfo",
      ...params,
    });
  }

  liveTvRecordings(params = {}) {
    return this._get("/LiveTv/Recordings", {
      UserId: this.userId,
      EnableUserData: true,
      Fields: "Overview,PrimaryImageAspectRatio,ProductionYear,RunTimeTicks",
      ...params,
    });
  }

  async recordProgram(programId, { series = false } = {}) {
    const base = series ? "/LiveTv/SeriesTimers" : "/LiveTv/Timers";
    // Jellyfin returns both one-off and series defaults from this shared
    // endpoint; there is no /SeriesTimers/Defaults route.
    const defaults = await this._get("/LiveTv/Timers/Defaults", { ProgramId: programId });
    return this._req(base, { method: "POST", body: { ...defaults, ProgramId: programId } });
  }

  cancelRecording(timerId, { series = false } = {}) {
    const base = series ? "/LiveTv/SeriesTimers" : "/LiveTv/Timers";
    return this._req(`${base}/${timerId}`, { method: "DELETE" });
  }

  setFavorite(itemId, favorite) {
    return this._req(`/UserFavoriteItems/${itemId}${qs({ UserId: this.userId })}`, {
      method: favorite ? "POST" : "DELETE",
    });
  }

  /* --------------------------------- media -------------------------------- */

  /** Build an <img>-friendly URL (api_key in query, since headers are off the table). */
  image(item, type, { w = 600, h, q = 80 } = {}) {
    const id = typeof item === "object" ? item && item.Id : item;
    if (!id) return "";
    let url = `${this.serverUrl}/Items/${id}/Images/${type}?api_key=${encodeURIComponent(
      this.token,
    )}&quality=${q}&maxWidth=${w}`;
    if (h) url += `&maxHeight=${h}`;
    return url;
  }

  trickplayTileUrl(item, width, index, mediaSourceId) {
    const id = typeof item === "object" ? item?.Id : item;
    if (!id || !width || index == null) return "";
    return `${this.serverUrl}/Videos/${id}/Trickplay/${width}/${index}.jpg${qs({
      api_key: this.token,
      MediaSourceId: mediaSourceId,
    })}`;
  }

  /**
   * Ask Jellyfin whether this browser can play the source file as-is, or how
   * it needs to be transcoded if not — instead of assuming a transcode is
   * always required. Falls back to "must transcode" (a null source) if the
   * call itself fails, so playback still degrades gracefully.
   */
  async getPlaybackInfo(item, { mediaSourceId, maxBitrate, startPositionTicks = 0 } = {}) {
    const id = typeof item === "object" ? item && item.Id : item;
    if (!id) return { source: null, playSessionId: null };
    const ms =
      mediaSourceId || (typeof item === "object" ? item.MediaSources?.[0]?.Id : undefined);
    try {
      const data = await this._req(`/Items/${id}/PlaybackInfo`, {
        method: "POST",
        body: {
          UserId: this.userId,
          MediaSourceId: ms,
          MaxStreamingBitrate: maxBitrate,
          StartTimeTicks: startPositionTicks,
          AutoOpenLiveStream: true,
          DeviceProfile: buildDeviceProfile(),
        },
      });
      const sources = data?.MediaSources || [];
      const source = sources.find((s) => !ms || s.Id === ms) || sources[0] || null;
      return {
        ...data,
        source,
        playSessionId: data?.PlaySessionId || null,
        liveStreamId: source?.LiveStreamId || null,
        transcodingUrl: source?.TranscodingUrl || null,
      };
    } catch {
      return { source: null, playSessionId: null };
    }
  }

  /** HLS master playlist URL (Jellyfin transcodes to HLS on the server). */
  streamUrl(item, { mediaSourceId, maxBitrate, maxHeight, playSessionId, adaptive = true } = {}) {
    const id = typeof item === "object" ? item && item.Id : item;
    if (!id) return "";
    const source = typeof item === "object" ? item.MediaSources?.[0] : undefined;
    const ms = mediaSourceId || source?.Id;

    // The video HLS endpoint does not turn MaxStreamingBitrate into an encoder
    // target. It expects separate VideoBitrate and AudioBitrate values; without
    // them Jellyfin can fall back to a very low rendition (commonly 640 kbps).
    // Treat the quality target as a total budget and reserve a modest stereo
    // AAC allowance from it. The player supplies Auto's current ceiling; other
    // callers fall back to the source bitrate, then a high-quality default.
    const streamBitrates = source?.MediaStreams?.map((stream) => stream.BitRate || 0) || [];
    const detectedBitrate = source?.Bitrate || streamBitrates.reduce((sum, rate) => sum + rate, 0);
    const totalBitrate = maxBitrate || detectedBitrate || 20_000_000;
    const audioBitrate = Math.min(192_000, Math.max(96_000, Math.floor(totalBitrate / 8)));
    const videoBitrate = Math.max(500_000, totalBitrate - audioBitrate);

    // This is either Auto's adaptive path or the fallback once playback-info
    // negotiation rules out direct play. H264/AAC is the transcode target
    // virtually every browser can play, so it stays codec-stable.
    return `${this.serverUrl}/Videos/${id}/master.m3u8${qs({
      api_key: this.token,
      MediaSourceId: ms,
      PlaySessionId: playSessionId,
      VideoCodec: "h264",
      AudioCodec: "aac",
      VideoBitrate: videoBitrate,
      AudioBitrate: audioBitrate,
      MaxHeight: maxHeight,
      SegmentContainer: "ts",
      TranscodingMaxAudioChannels: 2,
      EnableAdaptiveBitrateStreaming: adaptive,
    })}`;
  }

  /** Direct-play / progressive URL (works for audio too). */
  directUrl(item, { mediaSourceId, audio = false } = {}) {
    const id = typeof item === "object" ? item && item.Id : item;
    if (!id) return "";
    const ms =
      mediaSourceId || (typeof item === "object" ? item.MediaSources && item.MediaSources[0] && item.MediaSources[0].Id : undefined);
    const kind = audio ? "Audio" : "Videos";
    let url = `${this.serverUrl}/${kind}/${id}/stream?Static=true&api_key=${encodeURIComponent(this.token)}`;
    if (ms) url += `&MediaSourceId=${encodeURIComponent(ms)}`;
    return url;
  }

  mediaUrl(path, { authenticate = true } = {}) {
    if (!path) return "";
    const url = new URL(path, `${this.serverUrl}/`);
    if (authenticate && !url.searchParams.has("api_key")) url.searchParams.set("api_key", this.token);
    return url.toString();
  }

  closeLiveStream(liveStreamId) {
    if (!liveStreamId) return Promise.resolve();
    return this._req(`/LiveStreams/Close${qs({ liveStreamId })}`, { method: "POST" }).catch(() => {});
  }

  registerCapabilities() {
    return this._req("/Sessions/Capabilities/Full", {
      method: "POST",
      body: {
        PlayableMediaTypes: ["Audio", "Video"],
        SupportedCommands: ["PlayState", "PlayNext", "SetVolume", "Mute", "Unmute", "ToggleMute", "SetAudioStreamIndex", "SetSubtitleStreamIndex"],
        SupportsMediaControl: true,
        SupportsPersistentIdentifier: true,
        DeviceProfile: buildDeviceProfile(),
      },
    }).catch(() => {});
  }

  pingPlayback(playSessionId) {
    if (!playSessionId) return Promise.resolve();
    return this._req(`/Sessions/Playing/Ping${qs({ playSessionId })}`, { method: "POST" }).catch(() => {});
  }

  connectSocket() {
    if (typeof WebSocket === "undefined" || this._socket?.readyState <= 1 || !this.token) return;
    this._socketStopped = false;
    let url;
    try {
      url = new URL(this.serverUrl);
    } catch {
      this._socketStopped = true;
      return;
    }
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/socket`;
    url.search = new URLSearchParams({ api_key: this.token, deviceId: getDeviceId() }).toString();
    const socket = new WebSocket(url);
    this._socket = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message?.MessageType === "SyncPlayGroupUpdate") {
          if (message.Data?.Type === "GroupJoined") this.inSyncPlay = true;
          if (["GroupLeft", "NotInGroup"].includes(message.Data?.Type)) this.inSyncPlay = false;
          if (message.Data?.Type === "PlayQueue") this.syncPlayQueue = message.Data?.Data?.Playlist || [];
        }
        this._socketListeners.forEach((listener) => listener(message));
      } catch {}
    };
    socket.onclose = () => {
      if (this._socket === socket) this._socket = null;
      if (this._socketStopped) return;
      // Retry only while our token still works. A 401/403 means the session is
      // dead, so reconnecting every few seconds would spam the server forever;
      // stop and let the session surface a re-sign-in instead.
      return this.me()
        .catch((e) => {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            this._socketStopped = true;
            this.onSessionExpired?.();
          }
        })
        .then(() => {
          if (!this._socketStopped)
            window.setTimeout(() => {
              if (!this._socketStopped) this.connectSocket();
            }, 2_500);
        });
    };
  }

  onSocketMessage(listener) {
    this._socketListeners.add(listener);
    return () => this._socketListeners.delete(listener);
  }

  disconnectSocket() {
    this._socketStopped = true;
    this._socket?.close();
    this._socket = null;
  }

  /* ------------------------------ play state ------------------------------ */

  startPlayback(item, { mediaSourceId, playMethod = "Transcode", playSessionId, positionTicks, ...state } = {}) {
    const itemId = typeof item === "object" ? item && item.Id : item;
    const msId =
      mediaSourceId ||
      (typeof item === "object" ? item.MediaSources && item.MediaSources[0] && item.MediaSources[0].Id : undefined);
    return this._req("/Sessions/Playing", {
      method: "POST",
      body: {
        ItemId: itemId,
        MediaSourceId: msId,
        PlayMethod: playMethod,
        PlaySessionId: playSessionId,
        PositionTicks: positionTicks,
        ...state,
      },
    }).catch(() => {});
  }

  reportProgress(itemId, { positionTicks, mediaSourceId, playSessionId, ...state } = {}) {
    return this._req("/Sessions/Playing/Progress", {
      method: "POST",
      body: {
        ItemId: itemId,
        PositionTicks: positionTicks,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        ...state,
      },
    }).catch(() => {});
  }

  stopPlayback(itemId, { positionTicks, mediaSourceId, playSessionId, ...state } = {}) {
    return this._req("/Sessions/Playing/Stopped", {
      method: "POST",
      body: {
        ItemId: itemId,
        PositionTicks: positionTicks,
        MediaSourceId: mediaSourceId,
        PlaySessionId: playSessionId,
        ...state,
      },
    }).catch(() => {});
  }

  markPlayed(itemId, { mediaSourceId } = {}) {
    return this._req(`/Users/${this.userId}/PlayedItems/${itemId}`, {
      method: "POST",
      body: {
        ItemId: itemId,
        MediaSourceId: mediaSourceId,
        IsPlayed: true,
        DeviceId: getDeviceId(),
      },
    }).catch(() => {});
  }

  syncPlayGroups() {
    return this._get("/SyncPlay/List");
  }

  async createSyncPlayGroup(groupName) {
    const result = await this._req("/SyncPlay/New", { method: "POST", body: { GroupName: groupName } });
    this.inSyncPlay = true;
    return result;
  }

  async joinSyncPlayGroup(groupId) {
    const result = await this._req("/SyncPlay/Join", { method: "POST", body: { GroupId: groupId } });
    this.inSyncPlay = true;
    return result;
  }

  async leaveSyncPlayGroup() {
    const result = await this._req("/SyncPlay/Leave", { method: "POST" });
    this.inSyncPlay = false;
    return result;
  }

  syncPlayPause() {
    return this._req("/SyncPlay/Pause", { method: "POST" });
  }

  syncPlayUnpause() {
    return this._req("/SyncPlay/Unpause", { method: "POST" });
  }

  syncPlaySeek(positionTicks) {
    return this._req("/SyncPlay/Seek", { method: "POST", body: { PositionTicks: positionTicks } });
  }

  syncPlaySetQueue(itemIds, startPositionTicks = 0) {
    return this._req("/SyncPlay/SetNewQueue", {
      method: "POST",
      body: {
        PlayingQueue: itemIds,
        PlayingItemPosition: 0,
        StartPositionTicks: startPositionTicks,
      },
    });
  }

  syncPlayReady(positionTicks, isPlaying) {
    const playlistItemId = this.syncPlayQueue[0]?.PlaylistItemId;
    return this._req("/SyncPlay/Ready", {
      method: "POST",
      body: {
        When: new Date().toISOString(),
        PositionTicks: positionTicks,
        IsPlaying: isPlaying,
        PlaylistItemId: playlistItemId,
      },
    });
  }
}
