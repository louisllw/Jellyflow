import { ticksToSeconds } from "../api/utils.js";

const INTRO_CHAPTER_NAMES = new Set(["intro", "introduction", "opening", "opening credits", "op"]);
const SEGMENT_TYPES = {
  1: "Commercial",
  3: "Recap",
  4: "Outro",
  5: "Intro",
};

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

export function findSkippableSegment(mediaSegments = [], chapters = [], duration = 0, current = 0) {
  const explicit = mediaSegments
    .map((segment) => {
      const type = typeof segment?.Type === "number" ? SEGMENT_TYPES[segment.Type] : segment?.Type;
      return {
        type,
        start: ticksToSeconds(segment?.StartTicks),
        end: ticksToSeconds(segment?.EndTicks),
        source: "media-segment",
      };
    })
    .filter((segment) => ["Recap", "Intro", "Commercial", "Outro"].includes(segment.type))
    .filter((segment) => validIntro(segment.start, segment.end, duration))
    .sort((a, b) => a.start - b.start);
  const active = explicit.find((segment) => current >= segment.start && current < segment.end - 1);
  if (active) return active;
  const intro = findIntroSegment(mediaSegments, chapters, duration);
  if (intro && current >= intro.start && current < intro.end - 1) return { ...intro, type: "Intro" };
  return null;
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

export function episodePlaybackHeading(item) {
  if (item?.Type !== "Episode") return null;

  const season = item.ParentIndexNumber === 0
    ? "Special"
    : item.ParentIndexNumber != null
      ? `S${item.ParentIndexNumber}`
      : item.SeasonName || "";
  const episode = item.IndexNumber != null ? `E${item.IndexNumber}` : "Episode";

  return {
    title: item.SeriesName || "Unknown series",
    subtitle: [[season, episode].filter(Boolean).join(" "), item.Name].filter(Boolean).join(" · "),
  };
}
