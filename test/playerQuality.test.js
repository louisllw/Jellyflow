import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAutoQuality,
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

test("Auto steps down after two weak samples", () => {
  const first = evaluateAutoQuality({
    currentKey: "720",
    bufferedAhead: 2,
    bandwidth: 5_000_000,
    lowSamples: 0,
    highSamples: 0,
  });
  assert.deepEqual(first, { nextKey: "720", lowSamples: 1, highSamples: 0 });
  const second = evaluateAutoQuality({
    currentKey: "720",
    bufferedAhead: 2,
    bandwidth: 5_000_000,
    lowSamples: first.lowSamples,
    highSamples: first.highSamples,
  });
  assert.deepEqual(second, { nextKey: "480", lowSamples: 0, highSamples: 0 });
});

test("Auto steps up only after three strong samples", () => {
  let state = { nextKey: "480", lowSamples: 0, highSamples: 0 };
  for (let sample = 0; sample < 2; sample += 1) {
    state = evaluateAutoQuality({
      currentKey: "480",
      bufferedAhead: 20,
      bandwidth: 14_000_000,
      lowSamples: state.lowSamples,
      highSamples: state.highSamples,
    });
    assert.equal(state.nextKey, "480");
  }
  state = evaluateAutoQuality({
    currentKey: "480",
    bufferedAhead: 20,
    bandwidth: 14_000_000,
    lowSamples: state.lowSamples,
    highSamples: state.highSamples,
  });
  assert.equal(state.nextKey, "720");
});

test("lower-quality recovery stops at 360p", () => {
  assert.equal(lowerQualityKey("1080"), "720");
  assert.equal(lowerQualityKey("720"), "480");
  assert.equal(lowerQualityKey("360"), "360");
});
