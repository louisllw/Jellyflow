import test from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};

const { Jellyfin } = await import("../src/api/jellyfin.js");

// Minimal WebSocket stand-in: connectSocket() only reads the constructor,
// assigns onmessage/onclose and tracks readyState.
let sockets;
function installWebSocket() {
  sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0; // CONNECTING
      sockets.push(this);
    }
    close() {
      this.readyState = 3;
    }
    simulateClose() {
      this.readyState = 3;
      this.onclose?.();
    }
  }
  globalThis.WebSocket = FakeSocket;
}
globalThis.window = globalThis;

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

// Let the microtask chain inside onclose (me() probe -> .then) settle.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("socket reconnect stops permanently when the token is dead", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installWebSocket();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (new URL(url).pathname.endsWith("/Users/u")) return json({ Message: "Token is required." }, 401);
    return json({});
  };
  try {
    const client = new Jellyfin({ serverUrl: "https://example.test", token: "dead", userId: "u" });
    let expired = 0;
    client.onSessionExpired = () => { expired += 1; };
    client.connectSocket();
    assert.equal(sockets.length, 1);
    assert.equal(new URL(sockets[0].url).searchParams.get("ApiKey"), "dead");
    assert.equal(new URL(sockets[0].url).searchParams.has("api_key"), false);

    sockets[0].simulateClose();
    await flush();
    assert.equal(client._socketStopped, true);
    assert.equal(expired, 1);

    // Reconnects must stay off even well past the retry interval.
    t.mock.timers.tick(10_000);
    await flush();
    assert.equal(sockets.length, 1);
    assert.equal(expired, 1);
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.WebSocket;
    t.mock.timers.reset();
  }
});

test("socket reconnects on the 2.5s timer while the token is still valid", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installWebSocket();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => json({ Id: "u", Name: "Viewer" });
  try {
    const client = new Jellyfin({ serverUrl: "https://example.test", token: "live", userId: "u" });
    client.connectSocket();
    sockets[0].simulateClose();
    await flush();
    assert.equal(client._socketStopped, false);
    assert.equal(sockets.length, 1);

    t.mock.timers.tick(2_500);
    await flush();
    assert.equal(sockets.length, 2);
  } finally {
    globalThis.fetch = previousFetch;
    delete globalThis.WebSocket;
    t.mock.timers.reset();
  }
});

test("connectSocket does nothing without a token", async () => {
  installWebSocket();
  try {
    const client = new Jellyfin({ serverUrl: "https://example.test", userId: "u" });
    client.connectSocket();
    assert.equal(sockets.length, 0);
  } finally {
    delete globalThis.WebSocket;
  }
});
