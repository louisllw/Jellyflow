import test from "node:test";
import assert from "node:assert/strict";
import {
  autoHlsConfig,
  autoStepUpDecision,
  connectionBandwidthEstimate,
  levelForBandwidth,
} from "../src/components/adaptivePlayback.js";

test("connection estimates use browser throughput and mobile fallbacks", () => {
  assert.equal(connectionBandwidthEstimate({ downlink: 10 }), 10_000_000);
  assert.equal(connectionBandwidthEstimate({ effectiveType: "3g" }), 1_800_000);
  assert.equal(connectionBandwidthEstimate({}), null);
});

test("connection changes pick the highest safe rendition", () => {
  const levels = [
    { bitrate: 1_000_000 },
    { bitrate: 3_000_000 },
    { bitrate: 7_000_000 },
    { bitrate: 15_000_000 },
  ];
  assert.equal(levelForBandwidth(levels, 9_000_000), 2);
  assert.equal(levelForBandwidth(levels, 2_000_000), 0);
});

test("Auto ABR is not capped to the rendered player size", () => {
  const config = autoHlsConfig(8_000_000);
  assert.equal(config.capLevelToPlayerSize, false);
  assert.equal(config.capLevelOnFPSDrop, false);
  assert.equal(config.abrEwmaDefaultEstimate, 8_000_000);
  assert.ok(config.abrEwmaFastVoD < config.abrEwmaSlowVoD);
  assert.ok(config.maxBufferLength <= 12);
  assert.ok(config.fragLoadPolicy.default.maxLoadTimeMs <= 15_000);
});

test("Auto steps up one distinct rendition after two strong fragment samples", () => {
  const levels = [
    { height: 540, bitrate: 2_000_000 },
    { height: 720, bitrate: 5_000_000 },
    { height: 1080, bitrate: 10_000_000 },
  ];
  const first = autoStepUpDecision({
    levels,
    currentLevel: 0,
    fragmentBandwidth: 8_000_000,
    bufferedAhead: 8,
  });
  assert.deepEqual(first, { level: 0, strongSamples: 1 });
  assert.deepEqual(autoStepUpDecision({
    levels,
    currentLevel: 0,
    fragmentBandwidth: 8_000_000,
    bufferedAhead: 8,
    strongSamples: first.strongSamples,
  }), { level: 1, strongSamples: 0 });
});

test("Auto does not force an upshift without enough headroom or buffer", () => {
  const levels = [
    { height: 540, bitrate: 2_000_000 },
    { height: 720, bitrate: 5_000_000 },
  ];
  assert.deepEqual(autoStepUpDecision({
    levels,
    currentLevel: 0,
    fragmentBandwidth: 5_500_000,
    bufferedAhead: 8,
    strongSamples: 1,
  }), { level: 0, strongSamples: 0 });
  assert.deepEqual(autoStepUpDecision({
    levels,
    currentLevel: 0,
    fragmentBandwidth: 8_000_000,
    bufferedAhead: 2,
    strongSamples: 1,
  }), { level: 0, strongSamples: 0 });
});
