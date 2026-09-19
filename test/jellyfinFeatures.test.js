import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

const {
  Jellyfin,
  initiateQuickConnect,
  loginWithQuickConnect,
  quickConnectAvailable,
  quickConnectStatus,
} = await import("../src/api/jellyfin.js");

const json = (value) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { "content-type": "application/json" },
});

test("Quick Connect follows Jellyfin's initiate, poll and authenticate contract", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    if (path.endsWith("/Enabled")) return json(true);
    if (path.endsWith("/Initiate")) return json({ Code: "123456", Secret: "secret" });
    if (path.endsWith("/Connect")) return json({ Authenticated: true, Secret: "secret" });
    return json({ AccessToken: "token", User: { Id: "user", Name: "Viewer" } });
  };
  try {
    assert.equal(await quickConnectAvailable("https://example.test"), true);
    assert.equal((await initiateQuickConnect("https://example.test")).Code, "123456");
    assert.equal((await quickConnectStatus("https://example.test", "secret")).Authenticated, true);
    assert.equal((await loginWithQuickConnect("https://example.test", "secret")).token, "token");
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(new URL(calls[2].url).searchParams.get("secret"), "secret");
  assert.deepEqual(JSON.parse(calls[3].init.body), { Secret: "secret" });
});

test("server-path bitrate testing measures returned bytes and caches briefly", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(new Uint8Array(100_000), { status: 200 });
  };
  try {
    const client = new Jellyfin({ serverUrl: "https://example.test", token: "token", userId: "user" });
    assert.ok((await client.measureBitrate(100_000)) > 0);
    assert.ok((await client.measureBitrate(100_000)) > 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/Playback/BitrateTest");
  assert.equal(url.searchParams.get("size"), "100000");
});

test("discovery, extras and preference helpers target their official endpoints", async () => {
  const paths = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    paths.push(new URL(url).pathname);
    return json({ Items: [] });
  };
  const client = new Jellyfin({ serverUrl: "https://example.test", token: "token", userId: "user" });
  try {
    await client.suggestions();
    await client.movieRecommendations();
    await client.similarItems("item");
    await client.specialFeatures("item");
    await client.additionalParts("item");
    await client.displayPreferences();
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(paths, [
    "/Items/Suggestions",
    "/Movies/Recommendations",
    "/Items/item/Similar",
    "/Items/item/SpecialFeatures",
    "/Videos/item/AdditionalParts",
    "/DisplayPreferences/jellyflow",
  ]);
});
