import test from "node:test";
import assert from "node:assert/strict";
import {
  episodePlaybackHeading,
  findIntroSegment,
  findSkippableSegment,
  loadPlaybackSegments,
  transcodeReasons,
} from "../src/components/playbackMetadata.js";

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

test("supports paired Intro Start and Intro End chapter markers", () => {
  assert.deepEqual(
    findIntroSegment([], [
      { Name: "Intro Start", StartPositionTicks: ticks(8) },
      { Name: "Intro End", StartPositionTicks: ticks(76) },
      { Name: "Chapter 1", StartPositionTicks: ticks(90) },
    ], 1800),
    { start: 8, end: 76, source: "chapter" },
  );
  assert.deepEqual(
    findIntroSegment([], [
      { Name: "Chapter 1: Intro", StartPositionTicks: ticks(10) },
      { Name: "Chapter 2", StartPositionTicks: ticks(80) },
    ], 1800),
    { start: 10, end: 80, source: "chapter" },
  );
});

test("segment lookup retries the library item after an empty media source", async () => {
  const calls = [];
  const client = {
    mediaSegments: async (itemId) => {
      calls.push(itemId);
      return itemId === "episode-id" ? [{ Type: "Intro" }] : [];
    },
  };
  assert.deepEqual(
    await loadPlaybackSegments(client, { Id: "episode-id", MediaSources: [{ Id: "source-id" }] }),
    [{ Type: "Intro" }],
  );
  assert.deepEqual(calls, ["source-id", "episode-id"]);
});

test("finds recap, commercial and outro media segments at playback time", () => {
  const segments = [
    { Type: "Recap", StartTicks: ticks(0), EndTicks: ticks(45) },
    { Type: "Commercial", StartTicks: ticks(600), EndTicks: ticks(660) },
    { Type: "Outro", StartTicks: ticks(1700), EndTicks: ticks(1790) },
  ];
  assert.equal(findSkippableSegment(segments, [], 1800, 20)?.type, "Recap");
  assert.equal(findSkippableSegment(segments, [], 1800, 620)?.type, "Commercial");
  assert.equal(findSkippableSegment(segments, [], 1800, 1750)?.type, "Outro");
  assert.equal(findSkippableSegment(segments, [], 1800, 800), null);
});

test("extracts and humanizes Jellyfin transcode reasons", () => {
  assert.deepEqual(
    transcodeReasons({ TranscodingUrl: "/Videos/id/master.m3u8?TranscodeReasons=VideoCodecNotSupported,ContainerBitrateExceedsLimit" }),
    ["Video codec not supported", "Bitrate exceeds selected limit"],
  );
});

test("identifies an episode by series, season, number and title", () => {
  assert.deepEqual(episodePlaybackHeading({
    Type: "Episode",
    SeriesName: "Detectorists",
    ParentIndexNumber: 2,
    IndexNumber: 4,
    Name: "Episode Four",
  }), {
    title: "Detectorists",
    subtitle: "S2 E4 · Episode Four",
  });
  assert.deepEqual(episodePlaybackHeading({
    Type: "Episode",
    SeriesName: "Detectorists",
    ParentIndexNumber: 0,
    IndexNumber: 1,
    Name: "Christmas Special",
  }), {
    title: "Detectorists",
    subtitle: "Special E1 · Christmas Special",
  });
  assert.equal(episodePlaybackHeading({ Type: "Movie", Name: "A Film" }), null);
});
