import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { useSession } from "../state/Session.jsx";
import { mediaAuthHeader } from "../api/jellyfin.js";
import { fmtClock, isAudioOnly, isLiveTv, secondsToTicks, ticksToSeconds } from "../api/utils.js";
import { IconBack, IconSettings, IconInfo } from "./Icons.jsx";
import {
  AUTO_QUALITY_OPTIONS,
  initialAutoQuality,
  lowerQualityKey,
} from "./playerQuality.js";

const QUALITY_OPTIONS = [
  { key: "auto", label: "Auto" },
  ...AUTO_QUALITY_OPTIONS.slice().reverse(),
  { key: "original", label: "Original (direct)" },
];

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const LS_PREFS = "jellyflow.player.prefs";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LS_PREFS)) || {};
  } catch {
    return {};
  }
}

function savePrefs(patch) {
  try {
    localStorage.setItem(LS_PREFS, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {}
}

function trackPreference(track) {
  if (!track) return "";
  return `${track.lang || track.language || ""}|${track.name || track.label || ""}`.toLowerCase();
}

function preferredTrack(list, preference) {
  if (!preference) return null;
  const exact = list.find((track) => trackPreference(track) === preference);
  if (exact) return exact;
  const [language, name] = preference.split("|");
  return list.find((track) => {
    const [trackLanguage, trackName] = trackPreference(track).split("|");
    return (language && trackLanguage === language) || (!language && name && trackName === name);
  }) || null;
}

/**
 * A purpose-built video/audio player.
 *
 * - Video goes through hls.js when the browser can't do MSE-free HLS, and
 *   falls back to a plain <video> for direct-play / MP4 / audio.
 * - Playback position is reported back to Jellyfin (so "continue watching"
 *   and watched state stay in sync with the server).
 * - Quality, volume, playback speed, subtitle and audio track choices are
 *   remembered across sessions (a real, but small, rewatchability win).
 *
 * This is a full-screen overlay, not a route — so closing it returns to the
 * exact page and scroll position you came from.
 */
export function Player({ item, initialPosition = 0, nextItem = null, onPlayNext, onClose }) {
  const { client } = useSession();
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const reportTimer = useRef(null);
  const statsTimer = useRef(null);
  const idleTimer = useRef(null);
  const playSessionIdRef = useRef(null);
  const directStallsRef = useRef([]);
  const wakeLockRef = useRef(null);
  const cueTimingsRef = useRef(new WeakMap());
  const justExitedFsRef = useRef(false);
  const lastPositionRef = useRef(initialPosition);
  const resumeTargetRef = useRef(initialPosition);
  const fullscreenPlaybackRef = useRef({ shouldResume: false, position: 0 });
  // Intent, not state: only set by the user explicitly pausing/playing (the
  // toggle button, spacebar), never by onPause/onPlay — the video's own
  // paused state can't tell an OS-driven pause (see onVideoFsEnd) from the
  // user's own.
  const userPausedRef = useRef(false);
  const activePointerIdRef = useRef(null);
  const scrubRafRef = useRef(null);
  const pendingScrubFracRef = useRef(null);
  const prefs = useMemo(() => loadPrefs(), []);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedRanges, setBufferedRanges] = useState([]);
  const [buffering, setBuffering] = useState(true);
  const [muted, setMuted] = useState(Boolean(prefs.muted));
  const [volume, setVolume] = useState(prefs.volume ?? 1);
  const [speed, setSpeed] = useState(prefs.speed ?? 1);
  const [error, setError] = useState(null);
  const [quality, setQuality] = useState(prefs.quality || "auto");
  const [autoQuality, setAutoQuality] = useState(initialAutoQuality);
  const [forceAdaptive, setForceAdaptive] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [showQuality, setShowQuality] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showTracks, setShowTracks] = useState(false);
  const [stats, setStats] = useState(null);
  const [audioTracks, setAudioTracks] = useState([]);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [subtitleTrack, setSubtitleTrack] = useState(-1);
  const [uiVisible, setUiVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPiP, setIsPiP] = useState(false);
  const [scrubFrac, setScrubFrac] = useState(null);
  const [hoverFrac, setHoverFrac] = useState(null);
  const [nextPromptDismissed, setNextPromptDismissed] = useState(false);
  const [subtitleSize, setSubtitleSize] = useState(prefs.subtitleSize || "normal");
  const [subtitleBackground, setSubtitleBackground] = useState(prefs.subtitleBackground || "shadow");
  const [subtitleDelay, setSubtitleDelay] = useState(prefs.subtitleDelay || 0);


  function isVideo(it) {
    return it && !isAudioOnly(it);
  }

  function reportablePosition(v) {
    const target = resumeTargetRef.current;
    return target > 1 && v.currentTime < target - 2 ? lastPositionRef.current : v.currentTime;
  }

  // hls.js (MSE) is the reliable path in every browser that supports it —
  // native HTML5 HLS is only for browsers without MSE (Safari/iOS). Both are
  // only the *fallback*: the loading effect below asks Jellyfin first
  // whether this browser can play the source as-is and upgrades to direct
  // play when it can. "original" is an explicit user override that skips
  // that negotiation and always plays the raw file.
  function fallbackMode() {
    if (!isVideo(item)) return "direct";
    if (quality === "original") return "direct";
    if (Hls.isSupported()) return "hls";
    const v = document.createElement("video");
    if (v.canPlayType("application/vnd.apple.mpegurl")) return "native-hls";
    return "direct";
  }

  /* ------------------------------- lifecycle ------------------------------- */

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    let retryTimer;
    let sessionStarted = false;
    let playSessionId = null;
    const untrackFns = [];

    // Re-runs whenever the quality choice changes, too. The previous effect's
    // cleanup has already detached the old source by the time this runs, which
    // resets `v.currentTime` to zero. Carry the position across that teardown
    // in a ref instead of trying to read it back from the emptied element.
    const resumeAt = Number.isFinite(lastPositionRef.current)
      ? lastPositionRef.current
      : initialPosition;
    const selectedQuality = quality === "auto" ? autoQuality : quality;
    const opt = QUALITY_OPTIONS.find((q) => q.key === selectedQuality);
    const mediaSourceId = item?.MediaSources?.[0]?.Id;
    lastPositionRef.current = resumeAt;
    resumeTargetRef.current = resumeAt;

    v.volume = volume;
    v.muted = muted;
    v.playbackRate = speed;
    setError(null);
    setBuffering(true);
    setAudioTracks([]);
    setSubtitleTracks([]);
    setAudioTrack(-1);
    setSubtitleTrack(-1);

    let resumeConfirmed = resumeAt <= 1;
    let resumeAttempts = 0;
    const applyResumePosition = () => {
      if (resumeConfirmed || v.readyState < 1 || v.seeking || resumeAttempts >= 3) return;
      try {
        resumeAttempts += 1;
        v.currentTime = resumeAt;
        lastPositionRef.current = resumeAt;
        setCurrent(resumeAt);
      } catch {
        // Some engines expose metadata just before the seekable timeline is
        // ready. `canplay` below gives the resume one more safe opportunity.
      }
    };
    const confirmResumePosition = () => {
      if (resumeConfirmed) return;
      if (v.currentTime >= resumeAt - 2) {
        resumeConfirmed = true;
        resumeTargetRef.current = 0;
      }
      else applyResumePosition();
    };
    const resumeAndPlay = () => {
      applyResumePosition();
      v.playbackRate = speed;
      if (!userPausedRef.current) v.play().catch(() => {});
    };
    v.addEventListener("loadedmetadata", applyResumePosition);
    v.addEventListener("canplay", confirmResumePosition);
    v.addEventListener("seeked", confirmResumePosition);

    // Direct play has no HLS master playlist to carry subtitle renditions,
    // so text tracks are added by hand from the item's own subtitle
    // streams — Jellyfin hands back a ready-to-fetch DeliveryUrl for every
    // one it can convert to WebVTT.
    const directSubtitleTracks = () => {
      const streams = item?.MediaSources?.[0]?.MediaStreams || [];
      return streams
        .filter((s) => s.Type === "Subtitle" && s.DeliveryUrl)
        .map((s, i) => ({
          id: i,
          name: s.DisplayTitle || s.Language || `Track ${i + 1}`,
          lang: s.Language,
          url: `${client.serverUrl}${s.DeliveryUrl}${
            s.DeliveryUrl.includes("?") ? "&" : "?"
          }api_key=${encodeURIComponent(client.token)}`,
        }));
    };

    // Direct play and native (Safari) HLS both decode in the browser itself,
    // so multi-audio selection goes through the native AudioTrackList API
    // rather than anything Jellyfin-specific.
    const wireNativeAudioTracks = () => {
      const at = v.audioTracks;
      if (!at) return undefined;
      let preferenceApplied = false;
      const sync = () => {
        const list = Array.from(at).map((t, i) => ({
          id: t.id || String(i),
          name: t.label || t.language || `Track ${i + 1}`,
          lang: t.language,
        }));
        setAudioTracks(list);
        if (!preferenceApplied) {
          const wanted = preferredTrack(list, loadPrefs().audioTrackPreference);
          if (wanted) {
            Array.from(at).forEach((track, index) => {
              track.enabled = (track.id || String(index)) === wanted.id;
            });
          }
          preferenceApplied = true;
        }
        const activeIndex = Array.from(at).findIndex((t) => t.enabled);
        setAudioTrack(activeIndex >= 0 ? list[activeIndex].id : -1);
      };
      at.addEventListener("addtrack", sync);
      at.addEventListener("removetrack", sync);
      at.addEventListener("change", sync);
      sync();
      return () => {
        at.removeEventListener("addtrack", sync);
        at.removeEventListener("removetrack", sync);
        at.removeEventListener("change", sync);
      };
    };

    // Safari's native HLS engine parses subtitle renditions from the master
    // playlist itself and exposes them as ordinary TextTracks — no manual
    // <track> injection needed there (unlike direct play, above).
    const wireNativeSubtitleTracks = () => {
      const tt = v.textTracks;
      if (!tt) return undefined;
      let preferenceApplied = false;
      const sync = () => {
        const list = Array.from(tt).map((t, i) => ({
          id: i,
          name: t.label || t.language || `Track ${i + 1}`,
          lang: t.language,
        }));
        setSubtitleTracks(list);
        if (!preferenceApplied) {
          const preference = loadPrefs().subtitleTrackPreference;
          const wanted = preferredTrack(list, preference);
          if (preference) {
            Array.from(tt).forEach((track, index) => {
              track.mode = preference !== "off" && wanted?.id === index ? "showing" : "hidden";
            });
          }
          preferenceApplied = true;
        }
        setSubtitleTrack(Array.from(tt).findIndex((t) => t.mode === "showing"));
      };
      tt.addEventListener("addtrack", sync);
      tt.addEventListener("removetrack", sync);
      tt.addEventListener("change", sync);
      sync();
      return () => {
        tt.removeEventListener("addtrack", sync);
        tt.removeEventListener("removetrack", sync);
        tt.removeEventListener("change", sync);
      };
    };

    (async () => {
      let mode = fallbackMode();
      // Ask Jellyfin whether this browser can play the source as-is. Fixed
      // qualities avoid a needless transcode when the source already fits;
      // Auto does the same when measured headroom is generous, and falls back
      // to adaptive HLS if the direct stream proves unstable.
      if (mode === "hls" || mode === "native-hls") {
        const info = await client.getPlaybackInfo(item, {
          mediaSourceId,
          maxBitrate: opt?.maxBitrate,
          startPositionTicks: secondsToTicks(resumeAt),
        });
        if (cancelled) return;
        playSessionId = info.playSessionId;
        // Original remains the explicit no-transcode choice. Fixed qualities
        // may direct-play when the source fits their limit; Auto only does so
        // with ample headroom and can promote itself to adaptive HLS on stalls.
        const sourceBitrate = info.source?.Bitrate || item?.MediaSources?.[0]?.Bitrate || 0;
        const autoDirectPlayFits =
          quality === "auto" &&
          !forceAdaptive &&
          sourceBitrate > 0 &&
          sourceBitrate <= (opt?.maxBitrate || 0) * 0.7;
        if (info.source?.SupportsDirectPlay && (quality !== "auto" || autoDirectPlayFits)) mode = "direct";
      }
      playSessionIdRef.current = playSessionId;

      const playMethod = mode === "direct" ? "DirectPlay" : "Transcode";
      client.startPlayback(item, {
        mediaSourceId,
        playMethod,
        playSessionId,
        positionTicks: secondsToTicks(resumeAt),
      });
      sessionStarted = true;

      if (mode === "direct") {
        setSubtitleTracks(directSubtitleTracks());
        const c = wireNativeAudioTracks();
        if (c) untrackFns.push(c);
      } else if (mode === "native-hls") {
        const c1 = wireNativeAudioTracks();
        const c2 = wireNativeSubtitleTracks();
        if (c1) untrackFns.push(c1);
        if (c2) untrackFns.push(c2);
      }

      if (mode === "hls") {
        const url = client.streamUrl(item, {
          maxBitrate: opt?.maxBitrate,
          maxHeight: opt?.maxHeight,
          playSessionId,
          adaptive: quality === "auto",
        });
        setStats((s) => ({
          ...(s || {}),
          playMethod: "Transcode (HLS)",
          autoProfile: quality === "auto" ? opt : null,
        }));
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          startLevel: -1,
          capLevelToPlayerSize: quality === "auto",
          capLevelOnFPSDrop: quality === "auto",
          // Seed HLS's estimator from the conservative connection profile
          // chosen at startup. After the first fragments it continuously
          // measures real throughput and switches variants inside this same
          // MediaSource, without replacing the video or discarding its buffer.
          ...(quality === "auto" && opt?.maxBitrate
            ? { abrEwmaDefaultEstimate: Math.max(500_000, Math.floor(opt.maxBitrate * 0.7)) }
            : {}),
          // Some servers reject the query-string api_key on HLS requests and
          // require the full Authorization header instead — hls.js can't rely
          // on <video src> query params, so we set it on every XHR it makes.
          xhrSetup: (xhr) => xhr.setRequestHeader("Authorization", mediaAuthHeader(client.token)),
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setStats((s) => ({ ...(s || {}), availableLevels: hls.levels?.length || 0 }));
          resumeAndPlay();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          const level = hls.levels?.[data.level];
          setStats((s) => ({
            ...(s || {}),
            level,
            bandwidthEstimate: hls.bandwidthEstimate,
            playMethod: "Transcode (HLS)",
          }));
        });

        // Jellyfin's HLS master playlist carries every text subtitle and every
        // audio stream as alternate renditions — hls.js can swap between them
        // instantly, with no restart, exactly like the quality-independent
        // track menus in a native player.
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
          const tracks = hls.audioTracks || [];
          setAudioTracks(tracks);
          const wanted = preferredTrack(tracks, loadPrefs().audioTrackPreference);
          if (wanted) hls.audioTrack = wanted.id;
          setAudioTrack(wanted?.id ?? hls.audioTrack);
        });
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => setAudioTrack(data.id));
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          const tracks = hls.subtitleTracks || [];
          setSubtitleTracks(tracks);
          const preference = loadPrefs().subtitleTrackPreference;
          const wanted = preferredTrack(tracks, preference);
          if (preference === "off") hls.subtitleTrack = -1;
          else if (wanted) hls.subtitleTrack = wanted.id;
          setSubtitleTrack(preference === "off" ? -1 : (wanted?.id ?? hls.subtitleTrack));
        });
        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => setSubtitleTrack(data.id));
        let networkRetries = 0;
        hls.on(Hls.Events.FRAG_LOADED, () => {
          networkRetries = 0;
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              networkRetries += 1;
              // A CORS-blocked response looks identical to a flaky network to
              // hls.js, so it retries forever — cap it and say so plainly.
              if (networkRetries > 6) {
                hls.destroy();
                setError(
                  !navigator.onLine
                    ? "You appear to be offline. Playback will retry when the connection returns."
                    : isLiveTv(item)
                    ? "This channel's stream keeps failing to load — your Jellyfin server (or its reverse proxy) may be missing CORS headers on live TV responses. Check its network/CORS configuration."
                    : "This stream keeps failing to load — check that the server is reachable and try again.",
                );
                return;
              }
              clearTimeout(retryTimer);
              retryTimer = setTimeout(() => hls.startLoad(), Math.min(8_000, 500 * 2 ** networkRetries));
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else {
              setError("This stream stopped part-way. It may still be processing — try again in a moment.");
              hls.destroy();
            }
          }
        });
      } else if (mode === "native-hls") {
        const url = client.streamUrl(item, {
          maxBitrate: opt?.maxBitrate,
          maxHeight: opt?.maxHeight,
          playSessionId,
          adaptive: quality === "auto",
        });
        v.src = url;
        v.load();
        v.onloadedmetadata = resumeAndPlay;
        setStats((s) => ({ ...(s || {}), playMethod: "HLS (native)" }));
      } else {
        // Direct / progressive / audio — the server hands back a playable file.
        const url = client.directUrl(item, { audio: isAudioOnly(item), mediaSourceId });
        v.src = url;
        v.load();
        v.onloadedmetadata = resumeAndPlay;
        setStats((s) => ({ ...(s || {}), playMethod: "Direct play" }));
      }
    })();

    return () => {
      cancelled = true;
      // Snapshot the outgoing stream before removeAttribute/load resets its
      // timeline. The next quality effect uses this value as its resume point.
      const outgoingPosition = reportablePosition(v);
      if (Number.isFinite(outgoingPosition)) lastPositionRef.current = outgoingPosition;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      untrackFns.forEach((fn) => fn());
      clearTimeout(retryTimer);
      clearTimeout(reportTimer.current);
      v.removeEventListener("loadedmetadata", applyResumePosition);
      v.removeEventListener("canplay", confirmResumePosition);
      v.removeEventListener("seeked", confirmResumePosition);
      v.onloadedmetadata = null;
      v.removeAttribute("src");
      v.load();
      if (sessionStarted) {
        const position = lastPositionRef.current;
        client.stopPlayback(item.Id, {
          positionTicks: position > 15 ? secondsToTicks(position) : undefined,
          mediaSourceId,
          playSessionId,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, autoQuality, forceAdaptive, reloadNonce]);

  // While the stats panel is open, sample the <video> element's own playback
  // quality counters (dropped frames, decoded resolution) a few times a second.
  useEffect(() => {
    if (!showStats) return;
    const tick = () => {
      const v = videoRef.current;
      if (!v) return;
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      const bufferedEnd = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
      setStats((s) => ({
        ...(s || {}),
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        droppedFrames: q?.droppedVideoFrames ?? 0,
        totalFrames: q?.totalVideoFrames ?? 0,
        bufferedAhead: Math.max(0, bufferedEnd - v.currentTime),
      }));
    };
    tick();
    statsTimer.current = setInterval(tick, 1000);
    return () => clearInterval(statsTimer.current);
  }, [showStats]);

  /* ------------------------- fullscreen & picture-in-picture ---------------- */

  useEffect(() => {
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    let resumeListenerTimer;
    let resumeCheckTimer;
    let removeResumePauseListener;
    const keepPlayingAfterExit = () => {
      const v = videoRef.current;
      const state = fullscreenPlaybackRef.current;
      if (!v || !state.shouldResume || userPausedRef.current) return;

      clearTimeout(resumeListenerTimer);
      clearTimeout(resumeCheckTimer);
      removeResumePauseListener?.();
      state.position = Math.max(state.position, v.currentTime || 0);

      // Keep the same media element and timeline. Only correct browsers that
      // pause as part of their fullscreen exit transition.
      if (state.position - v.currentTime > 1) v.currentTime = state.position;
      const resumeIfPaused = () => {
        if (!userPausedRef.current && v.paused) v.play().catch(() => {});
      };
      const onTransitionPause = () => {
        v.removeEventListener("pause", onTransitionPause);
        requestAnimationFrame(resumeIfPaused);
      };
      removeResumePauseListener = () => v.removeEventListener("pause", onTransitionPause);
      v.addEventListener("pause", onTransitionPause);
      requestAnimationFrame(resumeIfPaused);
      resumeCheckTimer = setTimeout(resumeIfPaused, 250);
      resumeListenerTimer = setTimeout(() => v.removeEventListener("pause", onTransitionPause), 1000);
    };
    const onFsChange = () => {
      const isFs = Boolean(fsEl());
      setIsFullscreen(isFs);
      if (isFs) {
        const v = videoRef.current;
        if (v && !v.paused) {
          fullscreenPlaybackRef.current = { shouldResume: true, position: v.currentTime };
        }
      } else {
        // Browsers exit fullscreen on Escape themselves, and this event
        // fires before that same keypress reaches our own keydown handler
        // below — so by the time it checks document.fullscreenElement,
        // fullscreen already looks off and it would otherwise close the
        // whole player instead of just leaving fullscreen. This flag tells
        // that handler "fullscreen just ended, don't also treat this as a
        // close" for the remainder of the current event loop turn.
        justExitedFsRef.current = true;
        setTimeout(() => {
          justExitedFsRef.current = false;
        }, 0);
        keepPlayingAfterExit();
      }
    };
    // iOS Safari has no Fullscreen API for arbitrary elements — only the
    // <video> itself can go fullscreen, with its own begin/end events.
    const onVideoFsBegin = () => {
      const v = videoRef.current;
      if (v && !v.paused) {
        fullscreenPlaybackRef.current = { shouldResume: true, position: v.currentTime };
      }
      setIsFullscreen(true);
    };
    const onVideoFsEnd = () => {
      setIsFullscreen(false);
      keepPlayingAfterExit();
    };
    const onPipEnter = () => setIsPiP(true);
    const onPipLeave = () => setIsPiP(false);
    const v = videoRef.current;
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    v?.addEventListener("webkitbeginfullscreen", onVideoFsBegin);
    v?.addEventListener("webkitendfullscreen", onVideoFsEnd);
    v?.addEventListener("enterpictureinpicture", onPipEnter);
    v?.addEventListener("leavepictureinpicture", onPipLeave);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
      v?.removeEventListener("webkitbeginfullscreen", onVideoFsBegin);
      v?.removeEventListener("webkitendfullscreen", onVideoFsEnd);
      v?.removeEventListener("enterpictureinpicture", onPipEnter);
      v?.removeEventListener("leavepictureinpicture", onPipLeave);
      clearTimeout(resumeListenerTimer);
      clearTimeout(resumeCheckTimer);
      removeResumePauseListener?.();
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    const v = videoRef.current;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch?.(() => {});
      return;
    }
    if (v) {
      fullscreenPlaybackRef.current = {
        shouldResume: !v.paused && !userPausedRef.current,
        position: v.currentTime,
      };
    }
    if (el?.requestFullscreen) {
      el.requestFullscreen().catch(() => {
        // Some mobile browsers reject container fullscreen — fall back to
        // the video element's own fullscreen, which is far more reliable.
        v?.webkitEnterFullscreen?.();
      });
    } else if (el?.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (v?.webkitEnterFullscreen) {
      // iOS Safari: only the <video> element itself can go fullscreen.
      v.webkitEnterFullscreen();
    }
  }, []);

  const togglePiP = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else v.requestPictureInPicture?.().catch(() => {});
  }, []);

  /* ------------------------------- auto-hide UI ------------------------------ */

  const wake = useCallback(() => {
    setUiVisible(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      setUiVisible(false);
      setShowSpeed(false);
      setShowTracks(false);
    }, 3000);
  }, []);

  useEffect(() => {
    if (!playing) {
      clearTimeout(idleTimer.current);
      setUiVisible(true);
      return;
    }
    wake();
    return () => clearTimeout(idleTimer.current);
  }, [playing, wake]);

  // Stats and quality are reference panels rather than momentary controls.
  // Keep either one open across the player's normal idle timeout, then close
  // it only when the viewer clicks/taps outside that specific panel.
  useEffect(() => {
    if (!showStats && !showQuality) return undefined;
    const openPanel = showStats ? "stats" : "quality";
    const closeOnOutsidePress = (event) => {
      if (event.target instanceof Element && event.target.closest(`[data-persistent-popover="${openPanel}"]`)) return;
      setShowStats(false);
      setShowQuality(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [showQuality, showStats]);

  /* --------------------------- report progress ----------------------------- */

  const report = useCallback(
    (pos) => {
      if (!client || !item || isLiveTv(item)) return;
      const ticks = secondsToTicks(pos);
      const ms = item.MediaSources?.[0]?.Id;
      client.reportProgress(item.Id, {
        positionTicks: ticks,
        mediaSourceId: ms,
        playSessionId: playSessionIdRef.current,
      });
    },
    [client, item],
  );

  // The source-loading effect owns start/stop for each individual play session
  // (including quality switches). This item-level cleanup only applies the
  // final watched/resume state.
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v || !item) return;
      const ms = item.MediaSources?.[0]?.Id;
      const d = v.duration;
      const finalPosition = Math.max(lastPositionRef.current || 0, v.currentTime || 0);
      const nearlyDone = d > 0 && finalPosition / d > 0.9;
      const watchedEnough = finalPosition > 15;
      if (isLiveTv(item)) return;
      if (nearlyDone) {
        client.markPlayed(item.Id, { mediaSourceId: ms });
      } else if (watchedEnough) {
        report(finalPosition);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  /* ------------------------------ video events ------------------------------ */

  const onTime = () => {
    const v = videoRef.current;
    if (!v) return;
    // timeupdate fires several times a second; the controls only display whole
    // seconds, so update React state once the displayed second changes.
    setCurrent((prev) => (Math.floor(v.currentTime) === Math.floor(prev) ? prev : v.currentTime));
    if (!resumeTargetRef.current || v.currentTime >= resumeTargetRef.current - 2) {
      lastPositionRef.current = v.currentTime;
      resumeTargetRef.current = 0;
    }
    setDuration(v.duration || 0);
    if (v.duration > 0) {
      setBufferedRanges(
        Array.from({ length: v.buffered.length }, (_, index) => ({
          left: (v.buffered.start(index) / v.duration) * 100,
          width: ((v.buffered.end(index) - v.buffered.start(index)) / v.duration) * 100,
        })),
      );
    }
    if (!reportTimer.current) {
      reportTimer.current = setTimeout(() => {
        reportTimer.current = null;
        report(reportablePosition(v));
      }, 5000);
    }
  };

  const onVideoWaiting = () => {
    setBuffering(true);
    const v = videoRef.current;
    if (quality !== "auto" || forceAdaptive || stats?.playMethod !== "Direct play" || !v || v.currentTime < 5) return;
    const now = Date.now();
    directStallsRef.current = [...directStallsRef.current.filter((time) => now - time < 60_000), now];
    if (directStallsRef.current.length >= 2) {
      directStallsRef.current = [];
      setForceAdaptive(true);
    }
  };

  const retryPlayback = useCallback(() => {
    setError(null);
    setReloadNonce((value) => value + 1);
  }, []);

  const retryAtLowerQuality = useCallback(() => {
    setError(null);
    setForceAdaptive(true);
    if (quality === "auto") {
      const lower = lowerQualityKey(autoQuality);
      if (lower === autoQuality) setReloadNonce((value) => value + 1);
      else setAutoQuality(lower);
      return;
    }
    const current = quality === "original" ? "1080" : quality;
    const lower = lowerQualityKey(current);
    if (lower === quality) setReloadNonce((value) => value + 1);
    else {
      setQuality(lower);
      savePrefs({ quality: lower });
    }
  }, [autoQuality, quality]);

  useEffect(() => {
    const onOnline = () => {
      if (error) retryPlayback();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [error, retryPlayback]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      userPausedRef.current = false;
      v.play().catch(() => {});
      setPlaying(true);
    } else {
      userPausedRef.current = true;
      v.pause();
      setPlaying(false);
      report(reportablePosition(v));
    }
  }, [report]);

  const skip = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
      resumeTargetRef.current = 0;
      lastPositionRef.current = v.currentTime;
      setCurrent(v.currentTime);
      report(v.currentTime);
    },
    [report],
  );

  const seekTo = useCallback(
    (frac) => {
      const v = videoRef.current;
      if (!v || !v.duration) return;
      v.currentTime = frac * v.duration;
      resumeTargetRef.current = 0;
      lastPositionRef.current = v.currentTime;
      setCurrent(v.currentTime);
      report(v.currentTime);
    },
    [report],
  );

  // Pointer Events (not onClick) so this also works as a real drag on touch:
  // without capturing the gesture here and disabling the browser's own
  // touch handling on this element (see touch-action in styles.css), a
  // drag on the seek bar was instead read as a page pan — scrolling the
  // page, or on a fast horizontal drag, triggering the browser's
  // swipe-to-go-back navigation.
  const fracFromEvent = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }, []);

  // Coalesces rapid pointermove events into at most one state update (and
  // re-render) per frame, rather than one per event — pointermove can fire
  // well above screen refresh rate.
  const scheduleScrubUpdate = useCallback((frac) => {
    pendingScrubFracRef.current = frac;
    if (scrubRafRef.current) return;
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = null;
      setScrubFrac(pendingScrubFracRef.current);
    });
  }, []);

  const onTrackPointerDown = useCallback(
    (e) => {
      if (!duration) return; // nothing to seek yet — avoid a scrub that seekTo() will silently drop
      e.currentTarget.setPointerCapture(e.pointerId);
      activePointerIdRef.current = e.pointerId;
      scheduleScrubUpdate(fracFromEvent(e));
      wake();
    },
    [duration, fracFromEvent, scheduleScrubUpdate, wake],
  );

  const onTrackPointerMove = useCallback(
    (e) => {
      if (activePointerIdRef.current === null) {
        if (e.pointerType !== "touch") setHoverFrac(fracFromEvent(e));
        return;
      }
      if (activePointerIdRef.current !== e.pointerId) return; // a second pointer on the track shouldn't hijack the drag
      scheduleScrubUpdate(fracFromEvent(e));
      wake();
    },
    [fracFromEvent, scheduleScrubUpdate, wake],
  );

  // Shared by pointerup (commit the seek), pointercancel (the browser
  // aborted the gesture — e.g. a second touch, or an edge-swipe reclaimed
  // for navigation — discard it, don't seek) and lostpointercapture (a
  // catch-all: guarantees the scrub state can't get stuck if up/cancel
  // never fires for some reason).
  const endScrub = useCallback(
    (e, commit) => {
      if (activePointerIdRef.current !== e.pointerId) return;
      activePointerIdRef.current = null;
      if (scrubRafRef.current) {
        cancelAnimationFrame(scrubRafRef.current);
        scrubRafRef.current = null;
      }
      if (commit) seekTo(fracFromEvent(e));
      setScrubFrac(null);
    },
    [fracFromEvent, seekTo],
  );

  const onTrackPointerUp = useCallback((e) => endScrub(e, true), [endScrub]);
  const onTrackPointerCancel = useCallback((e) => endScrub(e, false), [endScrub]);
  const onTrackLostPointerCapture = useCallback((e) => endScrub(e, false), [endScrub]);

  const changeVolume = useCallback((v01) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.min(1, Math.max(0, v01));
    v.volume = clamped;
    v.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
    savePrefs({ volume: clamped, muted: clamped === 0 });
  }, []);

  const changeSpeed = useCallback((rate) => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
    setSpeed(rate);
    savePrefs({ speed: rate });
    setShowSpeed(false);
  }, []);

  const selectAudioTrack = useCallback((id) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = id;
    } else {
      const at = videoRef.current?.audioTracks;
      if (at) for (let i = 0; i < at.length; i++) at[i].enabled = at[i].id === id;
    }
    setAudioTrack(id);
    savePrefs({ audioTrackPreference: trackPreference(audioTracks.find((track) => track.id === id)) });
  }, [audioTracks]);

  const selectSubtitleTrack = useCallback((id) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = id;
    } else {
      const tt = videoRef.current?.textTracks;
      if (tt) for (let i = 0; i < tt.length; i++) tt[i].mode = i === id ? "showing" : "hidden";
    }
    setSubtitleTrack(id);
    savePrefs({
      subtitleTrackPreference:
        id === -1 ? "off" : trackPreference(subtitleTracks.find((track) => track.id === id)),
    });
  }, [subtitleTracks]);

  const restoreDirectSubtitlePreference = useCallback(() => {
    const tracks = videoRef.current?.textTracks;
    if (!tracks) return;
    const preference = loadPrefs().subtitleTrackPreference;
    const wanted = preferredTrack(subtitleTracks, preference);
    if (preference) {
      for (let index = 0; index < tracks.length; index++) {
        tracks[index].mode = preference !== "off" && wanted?.id === index ? "showing" : "hidden";
      }
    }
    const active = Array.from(tracks).findIndex((track) => track.mode === "showing");
    setSubtitleTrack(preference === "off" ? -1 : (wanted?.id ?? active));
  }, [subtitleTracks]);

  const changeSubtitleStyle = useCallback((patch) => {
    if (patch.subtitleSize) setSubtitleSize(patch.subtitleSize);
    if (patch.subtitleBackground) setSubtitleBackground(patch.subtitleBackground);
    savePrefs(patch);
  }, []);

  const changeSubtitleDelay = useCallback((delta) => {
    setSubtitleDelay((currentDelay) => {
      const nextDelay = Math.max(-5, Math.min(5, Math.round((currentDelay + delta) * 2) / 2));
      savePrefs({ subtitleDelay: nextDelay });
      return nextDelay;
    });
  }, []);

  useEffect(() => {
    if (subtitleTrack === -1) return undefined;
    const applyDelay = () => {
      const tracks = videoRef.current?.textTracks;
      if (!tracks) return;
      for (const track of Array.from(tracks)) {
        for (const cue of Array.from(track.cues || [])) {
          let original = cueTimingsRef.current.get(cue);
          if (!original) {
            original = { startTime: cue.startTime, endTime: cue.endTime };
            cueTimingsRef.current.set(cue, original);
          }
          try {
            cue.startTime = Math.max(0, original.startTime + subtitleDelay);
            cue.endTime = Math.max(cue.startTime, original.endTime + subtitleDelay);
          } catch {}
        }
      }
    };
    applyDelay();
    const timer = setInterval(applyDelay, 500);
    return () => clearInterval(timer);
  }, [subtitleDelay, subtitleTrack]);

  // Keyboard: space toggles, arrows skip, m mutes, f fullscreen, p PiP, Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      const interactive = e.target instanceof Element && e.target.closest("button, input, select, [role='menuitemradio']");
      if (e.key === "Escape") {
        if (showQuality || showStats || showSpeed || showTracks) {
          setShowQuality(false);
          setShowStats(false);
          setShowSpeed(false);
          setShowTracks(false);
        } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else if (!justExitedFsRef.current) onClose();
      } else if (e.key === "Tab") {
        const focusable = Array.from(
          containerRef.current?.querySelectorAll("button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])") || [],
        ).filter((element) => element.getClientRects().length > 0);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      } else if (interactive) {
        return;
      } else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowRight" || e.key === "l") {
        skip(10);
      } else if (e.key === "ArrowLeft" || e.key === "j") {
        skip(-10);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        changeVolume(volume + 0.1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        changeVolume(volume - 0.1);
      } else if (e.key === "m") {
        changeVolume(muted ? volume || 1 : 0);
      } else if (e.key === "f") {
        toggleFullscreen();
      } else if (e.key === "p") {
        togglePiP();
      } else if (e.key === "c") {
        if (subtitleTracks.length) selectSubtitleTrack(subtitleTrack === -1 ? subtitleTracks[0].id : -1);
      } else if (e.key === ">" || e.key === ".") {
        const i = SPEED_OPTIONS.indexOf(speed);
        changeSpeed(SPEED_OPTIONS[Math.min(SPEED_OPTIONS.length - 1, i + 1)]);
      } else if (e.key === "<" || e.key === ",") {
        const i = SPEED_OPTIONS.indexOf(speed);
        changeSpeed(SPEED_OPTIONS[Math.max(0, i - 1)]);
      } else if (/^[0-9]$/.test(e.key)) {
        seekTo(Number(e.key) / 10);
      } else {
        return;
      }
      wake();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    onClose,
    toggle,
    skip,
    seekTo,
    changeVolume,
    changeSpeed,
    toggleFullscreen,
    togglePiP,
    volume,
    muted,
    speed,
    subtitleTracks,
    subtitleTrack,
    selectSubtitleTrack,
    showQuality,
    showSpeed,
    showStats,
    showTracks,
    wake,
  ]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return undefined;
    if ("MediaMetadata" in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item?.Name || "Jellyflow",
        artist: item?.SeriesName || item?.AlbumArtist || "",
        album: item?.SeasonName || item?.Album || "",
        artwork: item?.Id
          ? [{ src: client.image(item, "Primary", { w: 512, q: 88 }) }]
          : [],
      });
    }

    const handlers = {
      play: () => {
        userPausedRef.current = false;
        videoRef.current?.play().catch(() => {});
      },
      pause: () => {
        userPausedRef.current = true;
        videoRef.current?.pause();
      },
      seekbackward: (details) => skip(-(details.seekOffset || 10)),
      seekforward: (details) => skip(details.seekOffset || 10),
      seekto: (details) => {
        if (duration > 0 && Number.isFinite(details.seekTime)) seekTo(details.seekTime / duration);
      },
      stop: onClose,
      nexttrack: nextItem && onPlayNext ? onPlayNext : null,
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {}
      }
      navigator.mediaSession.metadata = null;
    };
  }, [client, duration, item, nextItem, onClose, onPlayNext, seekTo, skip]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (!duration || !Number.isFinite(duration) || !Number.isFinite(current)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: speed,
        position: Math.min(duration, Math.max(0, current)),
      });
    } catch {}
  }, [current, duration, playing, speed]);

  useEffect(() => {
    if (!("wakeLock" in navigator)) return undefined;
    let cancelled = false;
    const release = () => {
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
    const acquire = async () => {
      if (!playing || document.visibilityState !== "visible" || wakeLockRef.current) return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
      } catch {}
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };
    if (playing) acquire();
    else release();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [playing]);

  // Lock body scroll while the player is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    containerRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current);
    };
  }, []);

  const pct = scrubFrac ?? (duration ? current / duration : 0);
  const mediaStreams = useMemo(() => item?.MediaSources?.[0]?.MediaStreams || [], [item]);
  const videoStream = useMemo(() => mediaStreams.find((s) => s.Type === "Video"), [mediaStreams]);
  const audioStream = useMemo(() => mediaStreams.find((s) => s.Type === "Audio"), [mediaStreams]);
  const autoProfile = AUTO_QUALITY_OPTIONS.find((option) => option.key === autoQuality);
  const activeAutoHeight = stats?.level?.height || stats?.videoHeight || autoProfile?.maxHeight;
  const chapters = useMemo(
    () =>
      (item?.Chapters || [])
        .map((c) => ({ name: c.Name, time: ticksToSeconds(c.StartPositionTicks) }))
        .filter((c) => duration > 0 && c.time >= 0 && c.time < duration),
    [item, duration],
  );
  const trickplay = useMemo(() => {
    const sourceId = item?.MediaSources?.[0]?.Id;
    const manifests = item?.Trickplay || {};
    const widths = manifests[sourceId] || Object.values(manifests).find(Boolean);
    if (!widths) return null;
    const choices = Object.entries(widths)
      .map(([width, info]) => ({ ...info, Width: info?.Width || Number(width) }))
      .filter((info) => info.Width && info.Height && info.Interval && info.TileWidth && info.TileHeight)
      .sort((a, b) => Math.abs(a.Width - 320) - Math.abs(b.Width - 320));
    return choices[0] || null;
  }, [item]);
  const previewFrac = scrubFrac ?? hoverFrac;
  const seekPreview = useMemo(() => {
    if (previewFrac == null || !duration || isLiveTv(item)) return null;
    const time = Math.max(0, Math.min(duration, previewFrac * duration));
    const chapter = chapters.slice().reverse().find((entry) => entry.time <= time);
    if (!trickplay) return { time, chapter, frac: previewFrac };
    const thumbnailIndex = Math.min(
      Math.max(0, (trickplay.ThumbnailCount || 1) - 1),
      Math.floor((time * 1000) / trickplay.Interval),
    );
    const thumbnailsPerSheet = trickplay.TileWidth * trickplay.TileHeight;
    const sheetIndex = Math.floor(thumbnailIndex / thumbnailsPerSheet);
    const tileIndex = thumbnailIndex % thumbnailsPerSheet;
    const column = tileIndex % trickplay.TileWidth;
    const row = Math.floor(tileIndex / trickplay.TileWidth);
    return {
      time,
      chapter,
      frac: previewFrac,
      image: client.trickplayTileUrl(item, trickplay.Width, sheetIndex, item?.MediaSources?.[0]?.Id),
      imageStyle: {
        width: `${trickplay.Width}px`,
        height: `${trickplay.Height}px`,
        backgroundImage: `url("${client.trickplayTileUrl(item, trickplay.Width, sheetIndex, item?.MediaSources?.[0]?.Id)}")`,
        backgroundPosition: `${-column * trickplay.Width}px ${-row * trickplay.Height}px`,
        backgroundSize: `${trickplay.Width * trickplay.TileWidth}px ${trickplay.Height * trickplay.TileHeight}px`,
      },
    };
  }, [chapters, client, duration, item, previewFrac, trickplay]);

  /* --------------------------------- render -------------------------------- */

  return (
    <div
      ref={containerRef}
      className={`player ${uiVisible ? "" : "player-idle"} ${showStats || showQuality ? "player-popover-pinned" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${item?.Name || "media"}`}
      tabIndex={-1}
      onMouseMove={wake}
      onClick={wake}
    >
      <div className="player-top">
        <button className="player-btn player-back" onClick={onClose} aria-label="Back">
          <IconBack />
        </button>
        <div className="player-top-title">{item?.Name}</div>
      </div>

      {/* No crossOrigin attribute, deliberately: for a user-entered public
          server (genuinely cross-origin, unlike the container's own proxied
          setup — see the header comment in api/jellyfin.js), setting it
          would require Jellyfin's plain streaming endpoint to send CORS
          headers it doesn't send by default, and playback would fail
          outright — confirmed by testing both ways. Without it, cross-origin
          direct-play subtitles (directSubtitleTracks(), above) can't load,
          since <track> cue fetching does require it for a cross-origin src.
          Between "no captions" and "no video," this keeps video working. */}
      <video
        ref={videoRef}
        className={`player-video player-subtitle-${subtitleSize} player-subtitle-bg-${subtitleBackground}`}
        playsInline
        autoPlay
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={onVideoWaiting}
        onPlaying={() => setBuffering(false)}
        onTimeUpdate={onTime}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
        onEnded={() => {
          if (nextItem && onPlayNext) onPlayNext();
          else onClose();
        }}
        onDoubleClick={toggleFullscreen}
        onError={() => {
          if (hlsRef.current) return; // hls handles its own errors
          setBuffering(false);
          if (!error) {
            setError(
              navigator.onLine
                ? "Couldn't start this file. It may not be playable in this browser."
                : "You appear to be offline. Playback will retry when the connection returns.",
            );
          }
        }}
      >
        {subtitleTracks
          .filter((t) => t.url)
          .map((t) => (
            <track
              key={t.id}
              kind="subtitles"
              src={t.url}
              srcLang={t.lang || undefined}
              label={t.name}
              onLoad={restoreDirectSubtitlePreference}
            />
          ))}
      </video>

      {buffering && !error && (
        <div className="player-loading">
          <div className="spinner" style={{ position: "absolute", left: "-56px", top: "-56px" }} />
          loading
        </div>
      )}

      {error && (
        <div className="player-loading" style={{ flexDirection: "column", gap: 16 }}>
          <b style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{error}</b>
          <div className="player-error-actions">
            <button className="btn btn-primary" onClick={retryPlayback}>Retry</button>
            {!isLiveTv(item) && <button className="btn" onClick={retryAtLowerQuality}>Try lower quality</button>}
            {quality !== "original" && !isLiveTv(item) && (
              <button
                className="btn"
                onClick={() => {
                  setError(null);
                  setQuality("original");
                  savePrefs({ quality: "original" });
                }}
              >
                Play original
              </button>
            )}
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      )}

      {nextItem && duration > 0 && duration - current <= 30 && !nextPromptDismissed && !error && (
        <aside className="player-next" aria-label="Next episode">
          <div className="player-next-art" aria-hidden="true">
            {nextItem.PrimaryImageAspectRatio ? (
              <img src={client.image(nextItem, "Primary", { w: 360, h: 203, q: 82 })} alt="" />
            ) : (
              <span>E{nextItem.IndexNumber ?? "–"}</span>
            )}
          </div>
          <div className="player-next-copy">
            <span>Up next</span>
            <b>{nextItem.Name || "Next episode"}</b>
            <small>
              {nextItem.SeasonName || `Season ${nextItem.ParentIndexNumber ?? "–"}`} · Episode {nextItem.IndexNumber ?? "–"}
            </small>
          </div>
          <div className="player-next-actions">
            <button className="btn btn-primary" onClick={onPlayNext}>
              Play next
            </button>
            <button className="player-next-dismiss" onClick={() => setNextPromptDismissed(true)}>
              Watch credits
            </button>
          </div>
        </aside>
      )}

      <div className="player-bottom">
        <div
          className="player-track"
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerCancel}
          onLostPointerCapture={onTrackLostPointerCapture}
          onPointerLeave={() => setHoverFrac(null)}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(pct * (duration || 0))}
        >
          {bufferedRanges.map((range, index) => (
            <div
              className="player-buffered"
              key={`${index}-${range.left.toFixed(2)}`}
              style={{ left: `${range.left}%`, width: `${range.width}%` }}
            />
          ))}
          <div className="player-fill" style={{ width: `${pct * 100}%` }} />
          {chapters.map((c, i) => (
            <div
              key={i}
              className="player-chapter-mark"
              style={{ left: `${(c.time / duration) * 100}%` }}
              title={c.name}
            />
          ))}
          <div className="player-knob" style={{ left: `${pct * 100}%` }} />
          {seekPreview && (
            <div
              className="player-seek-preview"
              style={{ "--preview-left": `${seekPreview.frac * 100}%` }}
              aria-hidden="true"
            >
              {seekPreview.image && <div className="player-seek-preview-image" style={seekPreview.imageStyle} />}
              <div className="player-seek-preview-copy">
                {seekPreview.chapter?.name && <span>{seekPreview.chapter.name}</span>}
                <b>{fmtClock(seekPreview.time)}</b>
              </div>
            </div>
          )}
        </div>

        <div className="player-controls">
          <div className="player-primary-controls">
            <button className="player-btn player-play-toggle" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
              {playing ? <IconPauseSmall /> : <IconPlaySmall />}
            </button>
            <button className="player-btn player-skip" onClick={() => skip(-10)} aria-label="Back ten seconds">
              <span>−10</span>
            </button>
            <button className="player-btn player-skip" onClick={() => skip(10)} aria-label="Forward ten seconds">
              <span>+10</span>
            </button>
          </div>

          <div className="player-time">
            {isLiveTv(item) ? (
              <span className="player-live-tag">● LIVE</span>
            ) : (
              <>
                {fmtClock(current)} <span style={{ color: "var(--ink-faint)" }}>/ {fmtClock(duration)}</span>
              </>
            )}
          </div>

          <div className="player-spacer" />

          <div className="player-secondary-controls">
            <div className="player-volume">
              <button
                className="player-btn"
                onClick={() => changeVolume(muted ? volume || 1 : 0)}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? <IconMuteSmall /> : <IconVolSmall />}
              </button>
              <input
                className="player-volume-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
              />
            </div>

            {(audioTracks.length > 1 || subtitleTracks.length > 0) && (
              <div className="player-popover-wrap">
                <button
                  className={`player-btn ${showTracks ? "on" : ""}`}
                  onClick={() => {
                    setShowTracks((s) => !s);
                    setShowStats(false);
                    setShowQuality(false);
                    setShowSpeed(false);
                  }}
                  aria-label="Audio & subtitles"
                  title="Audio & subtitles"
                >
                  <IconCaptionsSmall />
                </button>
                {showTracks && (
                  <div className="player-menu player-menu-wide" role="menu">
                    {subtitleTracks.length > 0 && (
                      <>
                        <div className="player-menu-label">Subtitles</div>
                        <button
                          role="menuitemradio"
                          aria-checked={subtitleTrack === -1}
                          className={subtitleTrack === -1 ? "on" : ""}
                          onClick={() => selectSubtitleTrack(-1)}
                        >
                          Off
                        </button>
                        {subtitleTracks.map((t) => (
                          <button
                            key={t.id}
                            role="menuitemradio"
                            aria-checked={subtitleTrack === t.id}
                            className={subtitleTrack === t.id ? "on" : ""}
                            onClick={() => selectSubtitleTrack(t.id)}
                          >
                            {t.name || t.lang || `Track ${t.id + 1}`}
                          </button>
                        ))}
                        <div className="player-menu-label">Subtitle size</div>
                        <div className="player-menu-options">
                          {[
                            ["small", "Small"],
                            ["normal", "Normal"],
                            ["large", "Large"],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              role="menuitemradio"
                              aria-checked={subtitleSize === value}
                              className={subtitleSize === value ? "on" : ""}
                              onClick={() => changeSubtitleStyle({ subtitleSize: value })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="player-menu-label">Subtitle background</div>
                        <div className="player-menu-options">
                          {[
                            ["none", "None"],
                            ["shadow", "Shadow"],
                            ["dark", "Dark"],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              role="menuitemradio"
                              aria-checked={subtitleBackground === value}
                              className={subtitleBackground === value ? "on" : ""}
                              onClick={() => changeSubtitleStyle({ subtitleBackground: value })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="player-menu-label">Subtitle timing</div>
                        <div className="player-menu-options player-menu-options-delay">
                          <button role="menuitem" onClick={() => changeSubtitleDelay(-0.5)}>−0.5s</button>
                          <button
                            role="menuitem"
                            className={subtitleDelay === 0 ? "on" : ""}
                            onClick={() => changeSubtitleDelay(-subtitleDelay)}
                          >
                            {subtitleDelay > 0 ? "+" : ""}{subtitleDelay.toFixed(1)}s
                          </button>
                          <button role="menuitem" onClick={() => changeSubtitleDelay(0.5)}>+0.5s</button>
                        </div>
                      </>
                    )}
                    {audioTracks.length > 1 && (
                      <>
                        <div className="player-menu-label">Audio</div>
                        {audioTracks.map((t) => (
                          <button
                            key={t.id}
                            role="menuitemradio"
                            aria-checked={audioTrack === t.id}
                            className={audioTrack === t.id ? "on" : ""}
                            onClick={() => selectAudioTrack(t.id)}
                          >
                            {t.name || t.lang || `Track ${t.id + 1}`}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

          <div className="player-popover-wrap">
            <button
              className={`player-btn ${showSpeed ? "on" : ""}`}
              onClick={() => {
                setShowSpeed((s) => !s);
                setShowStats(false);
                setShowQuality(false);
                setShowTracks(false);
              }}
              aria-label="Playback speed"
              title="Playback speed"
            >
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{speed}×</span>
            </button>
            {showSpeed && (
              <div className="player-menu" role="menu">
                {SPEED_OPTIONS.map((s) => (
                  <button
                    key={s}
                    role="menuitemradio"
                    aria-checked={speed === s}
                    className={speed === s ? "on" : ""}
                    onClick={() => changeSpeed(s)}
                  >
                    {s === 1 ? "Normal" : `${s}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="player-popover-wrap player-stats-wrap player-persistent-popover" data-persistent-popover="stats">
            <button
              className={`player-btn ${showStats ? "on" : ""}`}
              onClick={() => {
                setShowStats((s) => !s);
                setShowQuality(false);
                setShowSpeed(false);
                setShowTracks(false);
              }}
              aria-label="Stats for nerds"
              title="Stats for nerds"
            >
              <IconInfo size={19} />
            </button>
            {showStats && (
              <div className="player-stats">
                <div className="player-stats-row">
                  <span>Play method</span>
                  <b>{stats?.playMethod || "—"}</b>
                </div>
                <div className="player-stats-row">
                  <span>Resolution</span>
                  <b>{stats?.videoWidth ? `${stats.videoWidth}×${stats.videoHeight}` : "—"}</b>
                </div>
                <div className="player-stats-row">
                  <span>Stream bitrate</span>
                  <b>{stats?.level?.bitrate ? `${Math.round(stats.level.bitrate / 1000)} kbps` : "—"}</b>
                </div>
                {quality === "auto" && (
                  <>
                    <div className="player-stats-row">
                      <span>Auto ceiling</span>
                      <b>{autoProfile ? `${autoProfile.maxHeight}p` : "—"}</b>
                    </div>
                    <div className="player-stats-row">
                      <span>Estimated connection</span>
                      <b>
                        {Number.isFinite(stats?.bandwidthEstimate)
                          ? `${(stats.bandwidthEstimate / 1_000_000).toFixed(1)} Mbps`
                          : "Measuring…"}
                      </b>
                    </div>
                  </>
                )}
                <div className="player-stats-row">
                  <span>Buffered ahead</span>
                  <b>{stats?.bufferedAhead != null ? `${stats.bufferedAhead.toFixed(1)}s` : "—"}</b>
                </div>
                <div className="player-stats-row">
                  <span>Dropped frames</span>
                  <b>
                    {stats?.droppedFrames ?? 0} / {stats?.totalFrames ?? 0}
                  </b>
                </div>
                <div className="player-stats-row">
                  <span>Container</span>
                  <b>{item?.MediaSources?.[0]?.Container?.toUpperCase() || "—"}</b>
                </div>
                <div className="player-stats-row">
                  <span>Video codec</span>
                  <b>{videoStream?.Codec?.toUpperCase() || "—"}</b>
                </div>
                <div className="player-stats-row">
                  <span>Audio codec</span>
                  <b>{audioStream?.Codec?.toUpperCase() || "—"}</b>
                </div>
              </div>
            )}
          </div>

          <div className="player-popover-wrap player-persistent-popover" data-persistent-popover="quality">
            <button
              className={`player-btn ${showQuality ? "on" : ""}`}
              onClick={() => {
                setShowQuality((s) => !s);
                setShowStats(false);
                setShowSpeed(false);
                setShowTracks(false);
              }}
              aria-label={`Quality: ${quality === "auto" ? `Auto, ${activeAutoHeight}p` : quality}`}
              title={quality === "auto" ? `Auto · ${activeAutoHeight}p` : "Quality"}
            >
              <IconSettings size={19} />
            </button>
            {showQuality && (
              <div className="player-menu" role="menu">
                {QUALITY_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    role="menuitemradio"
                    aria-checked={quality === o.key}
                    className={quality === o.key ? "on" : ""}
                    onClick={() => {
                      if (o.key === "auto" && quality !== "auto") {
                        setAutoQuality(initialAutoQuality());
                        setForceAdaptive(false);
                        directStallsRef.current = [];
                      }
                      setQuality(o.key);
                      savePrefs({ quality: o.key });
                      setShowQuality(false);
                    }}
                  >
                    {o.key === "auto" && quality === "auto" ? `Auto · ${activeAutoHeight}p` : o.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button className="player-btn" onClick={togglePiP} aria-label="Picture in picture" title="Picture in picture">
            <IconPiPSmall />
          </button>

          <button
            className="player-btn"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <IconExitFullscreenSmall /> : <IconFullscreenSmall />}
          </button>
          </div>

          <div className="player-title">
            <b>{item?.Name || "Untitled"}</b>
            <span>
              {item?.ProductionYear ? item.ProductionYear + " · " : ""}
              {isAudioOnly(item) ? "Audio" : "Video"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


/* small glyphs so the control row stays visually light */
function IconPlaySmall() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}
function IconPauseSmall() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <rect x="7" y="5.5" width="3.6" height="13" rx="1" />
      <rect x="13.4" y="5.5" width="3.6" height="13" rx="1" />
    </svg>
  );
}
function IconVolSmall() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" />
      <path d="M15.5 9.5a4 4 0 0 1 0 5" />
    </svg>
  );
}
function IconMuteSmall() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" />
      <path d="m15.5 9.5 5 5m0-5-5 5" />
    </svg>
  );
}
function IconFullscreenSmall() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}
function IconExitFullscreenSmall() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9h4a1 1 0 0 0 1-1V4M20 9h-4a1 1 0 0 1-1-1V4M4 15h4a1 1 0 0 1 1 1v4M20 15h-4a1 1 0 0 0-1 1v4" />
    </svg>
  );
}
function IconPiPSmall() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconCaptionsSmall() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M7.5 11a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1M15.5 11a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h1" />
    </svg>
  );
}
