// Jellyfin API client — talks to any Jellyfin server straight from the browser.
//
// JSON calls use the X-Emby-Token header. Images and stream URLs use the
// `api_key` query parameter instead, because <img> tags and the hls.js XHR
// pipeline cannot set custom headers.

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
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
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
      ...extra,
    });
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
      Fields: "PrimaryImageAspectRatio,Overview,MediaSources",
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
        "PrimaryImageAspectRatio,IndexNumber,OriginalRuntimeTicks,ProductionYear,Overview,CommunityRating",
      EnableUserData: true,
      ...params,
    });
  }

  search(term, params = {}) {
    return this._get("/Search/Hints", {
      SearchTerm: term,
      Limit: 48,
      ...params,
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

  /** HLS master playlist URL (Jellyfin transcodes to HLS on the server). */
  streamUrl(item, { mediaSourceId, maxBitrate, maxHeight } = {}) {
    const id = typeof item === "object" ? item && item.Id : item;
    if (!id) return "";
    const source = typeof item === "object" ? item.MediaSources?.[0] : undefined;
    const ms = mediaSourceId || source?.Id;

    // The video HLS endpoint does not turn MaxStreamingBitrate into an encoder
    // target. It expects separate VideoBitrate and AudioBitrate values; without
    // them Jellyfin can fall back to a very low rendition (commonly 640 kbps).
    // Treat the quality menu's bitrate as a total budget and reserve a modest
    // stereo AAC allowance from it. For Auto, use the source bitrate when the
    // item metadata provides one, with a sensible high-quality fallback.
    const streamBitrates = source?.MediaStreams?.map((stream) => stream.BitRate || 0) || [];
    const detectedBitrate = source?.Bitrate || streamBitrates.reduce((sum, rate) => sum + rate, 0);
    const totalBitrate = maxBitrate || detectedBitrate || 20_000_000;
    const audioBitrate = Math.min(192_000, Math.max(96_000, Math.floor(totalBitrate / 8)));
    const videoBitrate = Math.max(500_000, totalBitrate - audioBitrate);

    return `${this.serverUrl}/Videos/${id}/master.m3u8${qs({
      api_key: this.token,
      MediaSourceId: ms,
      VideoCodec: "h264",
      AudioCodec: "aac",
      VideoBitrate: videoBitrate,
      AudioBitrate: audioBitrate,
      MaxHeight: maxHeight,
      SegmentContainer: "ts",
      TranscodingMaxAudioChannels: 2,
      EnableAdaptiveBitrateStreaming: true,
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

  /* ------------------------------ play state ------------------------------ */

  startPlayback(item, { mediaSourceId, mediaVersion } = {}) {
    const itemId = typeof item === "object" ? item && item.Id : item;
    const msId =
      mediaSourceId ||
      (typeof item === "object" ? item.MediaSources && item.MediaSources[0] && item.MediaSources[0].Id : undefined);
    return this._req("/Sessions/Playing", {
      method: "POST",
      body: {
        ItemId: itemId,
        MediaSourceId: msId,
        PlayMethod: mediaVersion || "Transcode",
      },
    }).catch(() => {});
  }

  reportProgress(itemId, { positionTicks, mediaSourceId } = {}) {
    return this._req("/Sessions/Playing/Progress", {
      method: "POST",
      body: {
        ItemId: itemId,
        PositionTicks: positionTicks,
        MediaSourceId: mediaSourceId,
      },
    }).catch(() => {});
  }

  stopPlayback(itemId, { positionTicks, mediaSourceId } = {}) {
    return this._req("/Sessions/Playing/Stopped", {
      method: "POST",
      body: {
        ItemId: itemId,
        PositionTicks: positionTicks,
        MediaSourceId: mediaSourceId,
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
}
