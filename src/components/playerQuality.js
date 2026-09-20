export const AUTO_QUALITY_OPTIONS = [
  { key: "360", label: "360p · 1.2 Mbps", maxBitrate: 1_200_000, maxHeight: 360 },
  { key: "480", label: "480p · 3 Mbps", maxBitrate: 3_000_000, maxHeight: 480 },
  { key: "720", label: "720p · 8 Mbps", maxBitrate: 8_000_000, maxHeight: 720 },
  { key: "1080", label: "1080p · 20 Mbps", maxBitrate: 20_000_000, maxHeight: 1080 },
  { key: "2160", label: "4K · 50 Mbps", maxBitrate: 50_000_000, maxHeight: 2160 },
];

export const AUTO_CEILING_KEY = "1080";

export function qualityProfile(key) {
  return AUTO_QUALITY_OPTIONS.find((option) => option.key === key);
}

export function initialAutoQuality(downlink = globalThis.navigator?.connection?.downlink) {
  if (!Number.isFinite(downlink)) return "720";
  if (downlink >= 25) return "1080";
  if (downlink >= 10) return "720";
  if (downlink >= 4) return "480";
  return "360";
}

export function lowerQualityKey(currentKey) {
  const index = AUTO_QUALITY_OPTIONS.findIndex((option) => option.key === currentKey);
  return index > 0 ? AUTO_QUALITY_OPTIONS[index - 1].key : AUTO_QUALITY_OPTIONS[0].key;
}

export function sourceFitsProfile(source, profile) {
  if (!source || !profile) return false;
  const video = source.MediaStreams?.find((stream) => stream.Type === "Video");
  const bitrateFits = !source.Bitrate || source.Bitrate <= profile.maxBitrate;
  const heightFits = !video?.Height || video.Height <= profile.maxHeight;
  return bitrateFits && heightFits;
}
