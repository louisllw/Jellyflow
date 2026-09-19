import test from "node:test";
import assert from "node:assert/strict";
import {
  initialAutoQuality,
  lowerQualityKey,
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
