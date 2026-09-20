import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_CEILING_KEY,
  initialAutoQuality,
  lowerQualityKey,
  qualityProfile,
  sourceFitsProfile,
} from "../src/components/playerQuality.js";

test("initial Auto quality uses conservative connection thresholds", () => {
  assert.equal(initialAutoQuality(undefined), "720");
  assert.equal(initialAutoQuality(2), "360");
  assert.equal(initialAutoQuality(5), "480");
  assert.equal(initialAutoQuality(12), "720");
  assert.equal(initialAutoQuality(30), "1080");
});

test("lower-quality recovery stops at 360p", () => {
  assert.equal(lowerQualityKey("1080"), "720");
  assert.equal(lowerQualityKey("720"), "480");
  assert.equal(lowerQualityKey("360"), "360");
});

test("Auto has a 1080p ceiling while retaining a conservative starting estimate", () => {
  assert.equal(AUTO_CEILING_KEY, "1080");
  assert.equal(qualityProfile(AUTO_CEILING_KEY).maxHeight, 1080);
  assert.equal(initialAutoQuality(undefined), "720");
});

test("manual profiles only direct-play sources inside both caps", () => {
  const source4k = { Bitrate: 42_000_000, MediaStreams: [{ Type: "Video", Height: 2160 }] };
  const source1080 = { Bitrate: 14_000_000, MediaStreams: [{ Type: "Video", Height: 1080 }] };
  assert.equal(sourceFitsProfile(source4k, qualityProfile("1080")), false);
  assert.equal(sourceFitsProfile(source4k, qualityProfile("2160")), true);
  assert.equal(sourceFitsProfile(source1080, qualityProfile("1080")), true);
  assert.equal(sourceFitsProfile({ ...source1080, Bitrate: 28_000_000 }, qualityProfile("1080")), false);
});
