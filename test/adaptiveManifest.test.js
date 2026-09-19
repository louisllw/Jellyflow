import test from "node:test";
import assert from "node:assert/strict";
import { combineHlsMasters } from "../src/components/adaptiveManifest.js";

test("combines aligned quality masters with absolute variant URLs", () => {
  const manifest = combineHlsMasters([
    {
      url: "https://media.test/Videos/item/master.m3u8?MaxHeight=360",
      text: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=640x360\nmain.m3u8?quality=360",
    },
    {
      url: "https://media.test/Videos/item/master.m3u8?MaxHeight=1080",
      text: [
        "#EXTM3U",
        "#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID=\"subs\",URI=\"subs/main.m3u8\"",
        "#EXT-X-STREAM-INF:BANDWIDTH=20000000,RESOLUTION=1920x1080,SUBTITLES=\"subs\"",
        "main.m3u8?quality=1080",
      ].join("\n"),
    },
  ]);
  assert.match(manifest, /BANDWIDTH=1200000/);
  assert.match(manifest, /BANDWIDTH=20000000/);
  assert.match(manifest, /https:\/\/media\.test\/Videos\/item\/main\.m3u8\?quality=360/);
  assert.match(manifest, /URI="https:\/\/media\.test\/Videos\/item\/subs\/main\.m3u8"/);
});

test("rejects empty Jellyfin master playlists", () => {
  assert.throws(() => combineHlsMasters([{ url: "https://media.test/master.m3u8", text: "#EXTM3U" }]));
});
