import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

const { Jellyfin } = await import("../src/api/jellyfin.js");

function client() {
  return new Jellyfin({ serverUrl: "https://example.test", token: "secret", userId: "user" });
}

test("HLS URLs preserve the quality target and adaptive flag", () => {
  const item = { Id: "item", MediaSources: [{ Id: "source", Bitrate: 12_000_000, MediaStreams: [] }] };
  const adaptive = new URL(client().streamUrl(item, {
    maxBitrate: 8_000_000,
    maxHeight: 720,
    playSessionId: "play-session",
    adaptive: true,
  }));
  assert.equal(adaptive.searchParams.get("VideoBitrate"), "7808000");
  assert.equal(adaptive.searchParams.get("AudioBitrate"), "192000");
  assert.equal(adaptive.searchParams.get("MaxHeight"), "720");
  assert.equal(adaptive.searchParams.get("EnableAdaptiveBitrateStreaming"), "true");

  const fixed = new URL(client().streamUrl(item, { maxBitrate: 3_000_000, adaptive: false }));
  assert.equal(fixed.searchParams.get("EnableAdaptiveBitrateStreaming"), "false");
});

test("playback session start reports the negotiated method and session", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };
  try {
    await client().startPlayback({ Id: "item", MediaSources: [{ Id: "source" }] }, {
      playMethod: "DirectPlay",
      playSessionId: "play-session",
      positionTicks: 123_000_000,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/Sessions/Playing");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ItemId: "item",
    MediaSourceId: "source",
    PlayMethod: "DirectPlay",
    PlaySessionId: "play-session",
    PositionTicks: 123_000_000,
  });
});

test("playback session stop targets the matching session", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  };
  try {
    await client().stopPlayback("item", {
      mediaSourceId: "source",
      playSessionId: "play-session",
      positionTicks: 456_000_000,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(new URL(calls[0].url).pathname, "/Sessions/Playing/Stopped");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ItemId: "item",
    PositionTicks: 456_000_000,
    MediaSourceId: "source",
    PlaySessionId: "play-session",
  });
});

test("item details request playback sources and trickplay metadata", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await client().item("item");
  } finally {
    globalThis.fetch = previousFetch;
  }
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get("UserId"), "user");
  assert.equal(url.searchParams.get("Fields"), "MediaSources,MediaStreams,Trickplay");
});

test("trickplay tile URL includes the selected media source", () => {
  const url = new URL(client().trickplayTileUrl("item", 320, 2, "source"));
  assert.equal(url.pathname, "/Videos/item/Trickplay/320/2.jpg");
  assert.equal(url.searchParams.get("MediaSourceId"), "source");
});
