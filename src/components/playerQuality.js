export const AUTO_QUALITY_OPTIONS = [
  { key: "360", label: "360p · 1.2 Mbps", maxBitrate: 1_200_000, maxHeight: 360 },
  { key: "480", label: "480p · 3 Mbps", maxBitrate: 3_000_000, maxHeight: 480 },
  { key: "720", label: "720p · 8 Mbps", maxBitrate: 8_000_000, maxHeight: 720 },
  { key: "1080", label: "1080p · 20 Mbps", maxBitrate: 20_000_000, maxHeight: 1080 },
];

export function initialAutoQuality(downlink = globalThis.navigator?.connection?.downlink) {
  if (!Number.isFinite(downlink)) return "720";
  if (downlink >= 25) return "1080";
  if (downlink >= 10) return "720";
  if (downlink >= 4) return "480";
  return "360";
}

export function evaluateAutoQuality({ currentKey, bufferedAhead, bandwidth, lowSamples, highSamples }) {
  const currentIndex = AUTO_QUALITY_OPTIONS.findIndex((option) => option.key === currentKey);
  const currentProfile = AUTO_QUALITY_OPTIONS[currentIndex];
  const lowerProfile = AUTO_QUALITY_OPTIONS[currentIndex - 1];
  const higherProfile = AUTO_QUALITY_OPTIONS[currentIndex + 1];
  if (!currentProfile) return { nextKey: currentKey, lowSamples: 0, highSamples: 0 };

  const shouldStepDown =
    Boolean(lowerProfile) &&
    (bufferedAhead < 4 ||
      (Number.isFinite(bandwidth) && bandwidth < currentProfile.maxBitrate * 0.9));
  const shouldStepUp =
    Boolean(higherProfile) &&
    bufferedAhead > 15 &&
    Number.isFinite(bandwidth) &&
    bandwidth > higherProfile.maxBitrate * 1.35;

  const nextLowSamples = shouldStepDown ? lowSamples + 1 : 0;
  const nextHighSamples = shouldStepUp ? highSamples + 1 : 0;
  if (nextLowSamples >= 2) return { nextKey: lowerProfile.key, lowSamples: 0, highSamples: 0 };
  if (nextHighSamples >= 3) return { nextKey: higherProfile.key, lowSamples: 0, highSamples: 0 };
  return { nextKey: currentKey, lowSamples: nextLowSamples, highSamples: nextHighSamples };
}

export function lowerQualityKey(currentKey) {
  const index = AUTO_QUALITY_OPTIONS.findIndex((option) => option.key === currentKey);
  return index > 0 ? AUTO_QUALITY_OPTIONS[index - 1].key : AUTO_QUALITY_OPTIONS[0].key;
}
