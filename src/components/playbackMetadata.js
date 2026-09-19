import { ticksToSeconds } from "../api/utils.js";

const INTRO_CHAPTER_NAMES = new Set(["intro", "introduction", "opening", "opening credits", "op"]);

const TRANSCODE_REASON_LABELS = {
  ContainerNotSupported: "Container not supported",
  VideoCodecNotSupported: "Video codec not supported",
  AudioCodecNotSupported: "Audio codec not supported",
  SubtitleCodecNotSupported: "Subtitle codec not supported",
  AudioIsExternal: "External audio",
  SecondaryAudioNotSupported: "Secondary audio not supported",
  VideoProfileNotSupported: "Video profile not supported",
  VideoRangeTypeNotSupported: "HDR range not supported",
  VideoCodecTagNotSupported: "Video codec tag not supported",
  VideoLevelNotSupported: "Video level not supported",
  VideoResolutionNotSupported: "Resolution exceeds device limit",
  VideoBitDepthNotSupported: "Video bit depth not supported",
  VideoFramerateNotSupported: "Frame rate not supported",
  AudioChannelsNotSupported: "Audio channels not supported",
  ContainerBitrateExceedsLimit: "Bitrate exceeds selected limit",
  VideoBitrateNotSupported: "Video bitrate not supported",
  AudioBitrateNotSupported: "Audio bitrate not supported",
  DirectPlayError: "Direct play failed",
};

function validIntro(start, end, duration) {
  return Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end - start >= 3 && end <= duration;
}

export function findIntroSegment(mediaSegments = [], chapters = [], duration = 0) {
  const explicit = mediaSegments.find((segment) => segment?.Type === "Intro" || segment?.Type === 5);
  if (explicit) {
    const start = ticksToSeconds(explicit.StartTicks);
    const end = ticksToSeconds(explicit.EndTicks);
    if (validIntro(start, end, duration)) return { start, end, source: "media-segment" };
  }

  const ordered = chapters
    .map((chapter) => ({ name: String(chapter?.Name || "").trim().toLowerCase(), time: ticksToSeconds(chapter?.StartPositionTicks) }))
    .filter((chapter) => Number.isFinite(chapter.time))
    .sort((a, b) => a.time - b.time);
  const introIndex = ordered.findIndex((chapter) => INTRO_CHAPTER_NAMES.has(chapter.name));
  if (introIndex < 0) return null;
  const start = ordered[introIndex].time;
  const end = ordered[introIndex + 1]?.time;
  const latestReliableStart = Math.min(duration * 0.25, 600);
  if (start > latestReliableStart || !validIntro(start, end, duration) || end - start > 300) return null;
  return { start, end, source: "chapter" };
}

function humanizeReason(reason) {
  return TRANSCODE_REASON_LABELS[reason] || String(reason).replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function transcodeReasons(source) {
  let values = source?.TranscodingReasons;
  if (typeof values === "string") values = values.split(",");
  if (!Array.isArray(values)) values = [];
  if (!values.length && source?.TranscodingUrl) {
    try {
      values = (new URL(source.TranscodingUrl, "https://jellyfin.invalid").searchParams.get("TranscodeReasons") || "").split(",");
    } catch {}
  }
  return [...new Set(values.filter(Boolean).map(humanizeReason))];
}
