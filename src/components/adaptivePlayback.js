const EFFECTIVE_TYPE_ESTIMATES = {
  "slow-2g": 250_000,
  "2g": 600_000,
  "3g": 1_800_000,
  "4g": 8_000_000,
};

export function connectionBandwidthEstimate(connection) {
  if (Number.isFinite(connection?.downlink) && connection.downlink > 0) {
    // Network Information reports megabits per second. hls.js applies the
    // configured up-switch safety factor to this estimate itself.
    return Math.max(250_000, connection.downlink * 1_000_000);
  }
  return EFFECTIVE_TYPE_ESTIMATES[connection?.effectiveType] || null;
}

export function levelForBandwidth(levels = [], estimate = 0) {
  if (!levels.length || !Number.isFinite(estimate) || estimate <= 0) return 0;
  const safeBandwidth = estimate * 0.82;
  let selected = 0;
  let selectedBitrate = 0;
  levels.forEach((level, index) => {
    const bitrate = level?.maxBitrate || level?.bitrate || Infinity;
    if (bitrate <= safeBandwidth && bitrate >= selectedBitrate) {
      selected = index;
      selectedBitrate = bitrate;
    }
  });
  return selected;
}

export function autoHlsConfig(defaultEstimate) {
  return {
    // Quality should follow available bandwidth, not the CSS pixel size of a
    // windowed player. FPS protection remains enabled separately.
    capLevelToPlayerSize: false,
    abrEwmaFastVoD: 1.5,
    abrEwmaSlowVoD: 4,
    abrBandWidthFactor: 0.9,
    abrBandWidthUpFactor: 0.82,
    abrMaxWithRealBitrate: true,
    maxStarvationDelay: 2,
    maxLoadingDelay: 2,
    maxBufferLength: 12,
    maxMaxBufferLength: 24,
    backBufferLength: 30,
    abrEwmaDefaultEstimate: Math.max(500_000, defaultEstimate || 0),
    abrEwmaDefaultEstimateMax: 25_000_000,
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 6_000,
        maxLoadTimeMs: 15_000,
        timeoutRetry: {
          maxNumRetry: 2,
          retryDelayMs: 0,
          maxRetryDelayMs: 1_000,
        },
        errorRetry: {
          maxNumRetry: 6,
          retryDelayMs: 500,
          maxRetryDelayMs: 4_000,
        },
      },
    },
  };
}
