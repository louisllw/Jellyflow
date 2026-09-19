import test from "node:test";
import assert from "node:assert/strict";
import { findIntroSegment, transcodeReasons } from "../src/components/playbackMetadata.js";

const ticks = (seconds) => seconds * 10_000_000;

test("prefers an explicit Jellyfin Intro media segment", () => {
  assert.deepEqual(
    findIntroSegment(
      [{ Type: "Intro", StartTicks: ticks(12), EndTicks: ticks(78) }],
      [{ Name: "Opening", StartPositionTicks: ticks(20) }, { Name: "Part 1", StartPositionTicks: ticks(90) }],
      1800,
    ),
    { start: 12, end: 78, source: "media-segment" },
  );
});

test("uses an exact, early chapter marker only when it has a safe end", () => {
  assert.deepEqual(
    findIntroSegment([], [{ Name: "Opening", StartPositionTicks: ticks(5) }, { Name: "Episode", StartPositionTicks: ticks(70) }], 1800),
    { start: 5, end: 70, source: "chapter" },
  );
  assert.equal(findIntroSegment([], [{ Name: "An introduction", StartPositionTicks: 0 }], 1800), null);
  assert.equal(findIntroSegment([], [{ Name: "Intro", StartPositionTicks: ticks(700) }, { Name: "Part", StartPositionTicks: ticks(760) }], 1800), null);
});

test("extracts and humanizes Jellyfin transcode reasons", () => {
  assert.deepEqual(
    transcodeReasons({ TranscodingUrl: "/Videos/id/master.m3u8?TranscodeReasons=VideoCodecNotSupported,ContainerBitrateExceedsLimit" }),
    ["Video codec not supported", "Bitrate exceeds selected limit"],
  );
});
