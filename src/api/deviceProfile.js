// What can this browser actually decode? Jellyfin's PlaybackInfo endpoint
// uses this DeviceProfile to decide, per file, whether to hand back the
// source as-is (direct play) or transcode it — so it's built from live
// canPlayType() probes rather than a fixed codec list.

let videoEl, audioEl;

function probe(el, mime) {
  try {
    return el.canPlayType(mime) !== "";
  } catch {
    return false;
  }
}

function probeVideo(mime) {
  videoEl ||= document.createElement("video");
  return probe(videoEl, mime);
}

function probeAudio(mime) {
  audioEl ||= document.createElement("audio");
  return probe(audioEl, mime);
}

const VIDEO_CODEC_PROBES = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L153.B0"',
  vp9: 'video/webm; codecs="vp9"',
  av1: 'video/mp4; codecs="av01.0.05M.08"',
  vp8: 'video/webm; codecs="vp8"',
};

const AUDIO_CODEC_PROBES = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: "audio/mpeg",
  flac: "audio/flac",
  opus: 'audio/webm; codecs="opus"',
  vorbis: 'audio/webm; codecs="vorbis"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
};

function supported(probes, probeFn) {
  return Object.entries(probes)
    .filter(([, mime]) => probeFn(mime))
    .map(([name]) => name);
}

/**
 * A DeviceProfile for POST /Items/{id}/PlaybackInfo. Direct-play profiles
 * reflect what this browser reports it can decode; the transcoding fallback
 * stays H264/AAC in HLS, since that's the one target virtually every browser
 * can play and it's only used once direct play has already been ruled out.
 */
export function buildDeviceProfile() {
  const videoCodecs = supported(VIDEO_CODEC_PROBES, probeVideo);
  const audioCodecs = supported(AUDIO_CODEC_PROBES, probeAudio);
  const webmVideo = videoCodecs.filter((c) => c === "vp8" || c === "vp9" || c === "av1");
  const webmAudio = audioCodecs.filter((c) => c === "opus" || c === "vorbis");
  const mp4Video = videoCodecs.filter((c) => c !== "vp8");
  // canPlayType under-reports Matroska support in some Chromium builds even
  // though the element can play it, so this is asked for directly.
  const mkv = probeVideo('video/x-matroska; codecs="avc1.640028,mp4a.40.2"');

  const directPlayProfiles = [];
  if (mp4Video.length) {
    directPlayProfiles.push({
      Type: "Video",
      Container: "mp4,m4v,mov",
      VideoCodec: mp4Video.join(","),
      AudioCodec: audioCodecs.join(","),
    });
    if (mkv) {
      directPlayProfiles.push({
        Type: "Video",
        Container: "mkv",
        VideoCodec: mp4Video.join(","),
        AudioCodec: audioCodecs.join(","),
      });
    }
  }
  if (webmVideo.length) {
    directPlayProfiles.push({
      Type: "Video",
      Container: "webm",
      VideoCodec: webmVideo.join(","),
      AudioCodec: webmAudio.join(","),
    });
  }
  directPlayProfiles.push({
    Type: "Audio",
    Container: "mp3,aac,m4a,m4b,flac,ogg,oga,opus,wav,webma,webm",
    AudioCodec: audioCodecs.join(","),
  });

  return {
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 120_000_000,
    MusicStreamingTranscodingBitrate: 320_000,
    DirectPlayProfiles: directPlayProfiles,
    TranscodingProfiles: [
      {
        Type: "Video",
        Container: "ts",
        Protocol: "hls",
        VideoCodec: "h264",
        AudioCodec: "aac",
        Context: "Streaming",
        MaxAudioChannels: "2",
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
      {
        Type: "Audio",
        Container: "aac",
        AudioCodec: "aac",
        Protocol: "hls",
        Context: "Streaming",
        MaxAudioChannels: "2",
      },
    ],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: "vtt", Method: "External" },
      { Format: "srt", Method: "External" },
      { Format: "subrip", Method: "External" },
      { Format: "ass", Method: "External" },
      { Format: "ssa", Method: "External" },
      { Format: "sub", Method: "External" },
    ],
  };
}
