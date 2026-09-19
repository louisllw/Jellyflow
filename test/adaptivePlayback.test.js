import test from "node:test";
import assert from "node:assert/strict";
import { autoHlsConfig, connectionBandwidthEstimate, levelForBandwidth } from "../src/components/adaptivePlayback.js";

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
  assert.equal(config.abrEwmaDefaultEstimate, 8_000_000);
  assert.ok(config.abrEwmaFastVoD < config.abrEwmaSlowVoD);
  assert.ok(config.maxBufferLength <= 12);
  assert.ok(config.fragLoadPolicy.default.maxLoadTimeMs <= 15_000);
});
