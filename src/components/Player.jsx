import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import { useSession } from "../state/Session.jsx";
import { mediaAuthHeader } from "../api/jellyfin.js";
import { fmtClock, isAudioOnly, isLiveTv, secondsToTicks, ticksToSeconds } from "../api/utils.js";
import { IconBack, IconSettings, IconInfo } from "./Icons.jsx";

const QUALITY_OPTIONS = [
  { key: "auto", label: "Auto" },
  { key: "1080", label: "1080p · 20 Mbps", maxBitrate: 20_000_000, maxHeight: 1080 },
  { key: "720", label: "720p · 8 Mbps", maxBitrate: 8_000_000, maxHeight: 720 },
  { key: "480", label: "480p · 3 Mbps", maxBitrate: 3_000_000, maxHeight: 480 },
  { key: "360", label: "360p · 1.2 Mbps", maxBitrate: 1_200_000, maxHeight: 360 },
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
export function Player({ item, initialPosition = 0, onClose }) {
  const { client } = useSession();
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const reportTimer = useRef(null);
  const statsTimer = useRef(null);
  const idleTimer = useRef(null);
  const playSessionIdRef = useRef(null);
  const justExitedFsRef = useRef(false);
  const prefs = useMemo(() => loadPrefs(), []);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(true);
  const [muted, setMuted] = useState(Boolean(prefs.muted));
  const [volume, setVolume] = useState(prefs.volume ?? 1);
  const [speed, setSpeed] = useState(prefs.speed ?? 1);
  const [error, setError] = useState(null);
  const [quality, setQuality] = useState(prefs.quality || "auto");
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


  function isVideo(it) {
    return it && !isAudioOnly(it);
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
    const untrackFns = [];

    // Re-runs whenever the quality choice changes, too — pick up wherever
    // playback currently is rather than restarting from zero.
    const resumeAt = v.currentTime > 1 ? v.currentTime : initialPosition;
    const opt = QUALITY_OPTIONS.find((q) => q.key === quality);
    const mediaSourceId = item?.MediaSources?.[0]?.Id;

    v.volume = volume;
    v.muted = muted;
    v.playbackRate = speed;
    setBuffering(true);
    setAudioTracks([]);
    setSubtitleTracks([]);
    setAudioTrack(-1);
    setSubtitleTrack(-1);

    const resumeAndPlay = () => {
      if (resumeAt > 1) {
        try {
          v.currentTime = resumeAt;
        } catch {}
      }
      v.playbackRate = speed;
      v.play().catch(() => {});
    };

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
      const sync = () => {
        const list = Array.from(at).map((t, i) => ({
          id: t.id || String(i),
          name: t.label || t.language || `Track ${i + 1}`,
          lang: t.language,
        }));
        setAudioTracks(list);
        const active = Array.from(at).find((t) => t.enabled);
        setAudioTrack(active ? active.id : -1);
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
      const sync = () => {
        const list = Array.from(tt).map((t, i) => ({
          id: i,
          name: t.label || t.language || `Track ${i + 1}`,
          lang: t.language,
        }));
        setSubtitleTracks(list);
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
      let playSessionId = null;

      // Ask Jellyfin whether this browser can play the source as-is before
      // paying for a transcode — most files don't need one, and this is
      // what stops every video defaulting to a re-encoded H264/AAC stream.
      if (mode === "hls" || mode === "native-hls") {
        const info = await client.getPlaybackInfo(item, {
          mediaSourceId,
          maxBitrate: opt?.maxBitrate,
          startPositionTicks: secondsToTicks(resumeAt),
        });
        if (cancelled) return;
        playSessionId = info.playSessionId;
        if (info.source?.SupportsDirectPlay) mode = "direct";
      }
      playSessionIdRef.current = playSessionId;

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
        });
        setStats((s) => ({ ...(s || {}), playMethod: "Transcode (HLS)" }));
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          // Some servers reject the query-string api_key on HLS requests and
          // require the full Authorization header instead — hls.js can't rely
          // on <video src> query params, so we set it on every XHR it makes.
          xhrSetup: (xhr) => xhr.setRequestHeader("Authorization", mediaAuthHeader(client.token)),
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, resumeAndPlay);
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          const level = hls.levels?.[data.level];
          setStats((s) => ({ ...(s || {}), level, playMethod: "Transcode (HLS)" }));
        });
        // Jellyfin's HLS master playlist carries every text subtitle and every
        // audio stream as alternate renditions — hls.js can swap between them
        // instantly, with no restart, exactly like the quality-independent
        // track menus in a native player.
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
          setAudioTracks(hls.audioTracks || []);
          setAudioTrack(hls.audioTrack);
        });
        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_e, data) => setAudioTrack(data.id));
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          setSubtitleTracks(hls.subtitleTracks || []);
          setSubtitleTrack(hls.subtitleTrack);
        });
        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_e, data) => setSubtitleTrack(data.id));
        let networkRetries = 0;
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              networkRetries += 1;
              // A CORS-blocked response looks identical to a flaky network to
              // hls.js, so it retries forever — cap it and say so plainly.
              if (networkRetries > 6) {
                hls.destroy();
                setError(
                  isLiveTv(item)
                    ? "This channel's stream keeps failing to load — your Jellyfin server (or its reverse proxy) may be missing CORS headers on live TV responses. Check its network/CORS configuration."
                    : "This stream keeps failing to load — check that the server is reachable and try again.",
                );
                return;
              }
              hls.startLoad();
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
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      untrackFns.forEach((fn) => fn());
      clearTimeout(reportTimer.current);
      v.onloadedmetadata = null;
      v.removeAttribute("src");
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);

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
    const onFsChange = () => {
      const isFs = Boolean(fsEl());
      setIsFullscreen(isFs);
      if (!isFs) {
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
      }
    };
    // iOS Safari has no Fullscreen API for arbitrary elements — only the
    // <video> itself can go fullscreen, with its own begin/end events.
    const onVideoFsBegin = () => setIsFullscreen(true);
    const onVideoFsEnd = () => setIsFullscreen(false);
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
      setShowQuality(false);
      setShowStats(false);
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

  // Close out the Jellyfin session on the way out — this is what releases
  // an active transcode job server-side instead of leaving it to time out —
  // then mark played / report the final position.
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v || !item) return;
      const ms = item.MediaSources?.[0]?.Id;
      client.stopPlayback(item.Id, {
        positionTicks: secondsToTicks(v.currentTime),
        mediaSourceId: ms,
        playSessionId: playSessionIdRef.current,
      });
      if (isLiveTv(item)) return;
      const d = v.duration;
      if (d > 0 && v.currentTime / d > 0.9) {
        client.markPlayed(item.Id, { mediaSourceId: ms });
      } else if (v.currentTime > 15) {
        report(v.currentTime);
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
    setDuration(v.duration || 0);
    if (!reportTimer.current) {
      reportTimer.current = setTimeout(() => {
        reportTimer.current = null;
        report(v.currentTime);
      }, 5000);
    }
  };

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPlaying(true);
    } else {
      v.pause();
      setPlaying(false);
      report(v.currentTime);
    }
  }, [report]);

  const skip = useCallback(
    (delta) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
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
      setCurrent(v.currentTime);
      report(v.currentTime);
    },
    [report],
  );

  const onTrackClick = (e) => {
    const track = e.currentTarget;
    const r = track.getBoundingClientRect();
    seekTo(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };

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
  }, []);

  const selectSubtitleTrack = useCallback((id) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = id;
    } else {
      const tt = videoRef.current?.textTracks;
      if (tt) for (let i = 0; i < tt.length; i++) tt[i].mode = i === id ? "showing" : "hidden";
    }
    setSubtitleTrack(id);
  }, []);

  // Keyboard: space toggles, arrows skip, m mutes, f fullscreen, p PiP, Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else if (!justExitedFsRef.current) onClose();
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
    wake,
  ]);

  // Lock body scroll while the player is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const pct = duration ? current / duration : 0;
  const mediaStreams = item?.MediaSources?.[0]?.MediaStreams || [];
  const videoStream = mediaStreams.find((s) => s.Type === "Video");
  const audioStream = mediaStreams.find((s) => s.Type === "Audio");
  const chapters = (item?.Chapters || [])
    .map((c) => ({ name: c.Name, time: ticksToSeconds(c.StartPositionTicks) }))
    .filter((c) => duration > 0 && c.time >= 0 && c.time < duration);

  /* --------------------------------- render -------------------------------- */

  return (
    <div
      ref={containerRef}
      className={`player ${uiVisible ? "" : "player-idle"}`}
      role="dialog"
      aria-label={`Playing ${item?.Name || "media"}`}
      onMouseMove={wake}
      onClick={wake}
    >
      <div className="player-top">
        <button className="player-btn player-back" onClick={onClose} aria-label="Back">
          <IconBack />
        </button>
        <div className="player-top-title">{item?.Name}</div>
      </div>

      <video
        ref={videoRef}
        className="player-video"
        playsInline
        autoPlay
        crossOrigin="anonymous"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onTimeUpdate={onTime}
        onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
        onLoadedMetadata={() => setDuration(videoRef.current?.duration || 0)}
        onEnded={() => onClose()}
        onDoubleClick={toggleFullscreen}
        onError={() => {
          if (hlsRef.current) return; // hls handles its own errors
          setBuffering(false);
          if (!error) setError("Couldn't start this file. It may not be playable in this browser.");
        }}
      >
        {subtitleTracks
          .filter((t) => t.url)
          .map((t) => (
            <track key={t.id} kind="subtitles" src={t.url} srcLang={t.lang || undefined} label={t.name} />
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
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      <div className="player-bottom">
        <div className="player-track" onClick={onTrackClick} role="slider" aria-label="Seek">
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

          <div className="player-popover-wrap player-stats-wrap">
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

          <div className="player-popover-wrap">
            <button
              className={`player-btn ${showQuality ? "on" : ""}`}
              onClick={() => {
                setShowQuality((s) => !s);
                setShowStats(false);
                setShowSpeed(false);
                setShowTracks(false);
              }}
              aria-label="Quality"
              title="Quality"
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
                      setQuality(o.key);
                      savePrefs({ quality: o.key });
                      setShowQuality(false);
                    }}
                  >
                    {o.label}
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
