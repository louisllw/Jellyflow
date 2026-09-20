import test from "node:test";
import assert from "node:assert/strict";

import { retireClient } from "../src/state/sessionLifecycle.js";

function fakeClient({ isApiKey = false } = {}) {
  const calls = [];
  return {
    cfg: { isApiKey },
    onSessionExpired: () => {},
    calls,
    disconnectSocket() { calls.push("disconnect"); },
    logout() { calls.push("logout"); return Promise.resolve(); },
  };
}

test("retiring a user session disconnects and revokes it", async () => {
  const client = fakeClient();
  await retireClient(client, { revoke: true });
  assert.deepEqual(client.calls, ["disconnect", "logout"]);
  assert.equal(client.onSessionExpired, null);
});

test("retiring an API-key session never deletes the shared key", async () => {
  const client = fakeClient({ isApiKey: true });
  await retireClient(client, { revoke: true });
  assert.deepEqual(client.calls, ["disconnect"]);
});

test("replacing a client can disconnect without revoking the same credential", async () => {
  const client = fakeClient();
  await retireClient(client);
  assert.deepEqual(client.calls, ["disconnect"]);
});

test("local sign-out still completes when server-side revocation fails", async () => {
  const client = fakeClient();
  client.logout = () => {
    client.calls.push("logout");
    return Promise.reject(new Error("server unavailable"));
  };
  await assert.doesNotReject(retireClient(client, { revoke: true }));
  assert.deepEqual(client.calls, ["disconnect", "logout"]);
});
