import test from "node:test";
import assert from "node:assert/strict";
import { playActionLabel, playbackExitPath } from "../src/components/playbackState.js";

test("completed playable media uses the Watched action label", () => {
  assert.equal(playActionLabel({ Type: "Movie", UserData: { Played: true } }), "Watched");
  assert.equal(playActionLabel({ Type: "Episode", UserData: { Played: true } }), "Watched");
});

test("unfinished media retains resume and play labels", () => {
  assert.equal(playActionLabel({ Type: "Movie", UserData: { Played: false } }, { resumePosition: 125 }), "Resume at 2:05");
  assert.equal(playActionLabel({ Type: "Movie" }), "Play");
  assert.equal(playActionLabel({ Type: "Series" }), "Play next episode");
  assert.equal(playActionLabel({ Type: "Series" }, { seriesLabel: "Continue the series" }), "Continue the series");
});

test("closing consecutive playback returns to the active episode", () => {
  const startingEpisode = { Id: "episode-1", Type: "Episode" };
  const activeEpisode = { Id: "episode-3", Type: "Episode" };
  assert.equal(playbackExitPath(startingEpisode, activeEpisode), "/item/episode-3");
  assert.equal(playbackExitPath(startingEpisode, startingEpisode), null);
  assert.equal(playbackExitPath({ Id: "movie-1", Type: "Movie" }, { Id: "movie-1", Type: "Movie" }), null);
});

test("an episode started from a series page exits to that episode", () => {
  assert.equal(
    playbackExitPath({ Id: "series-1", Type: "Series" }, { Id: "episode-4", Type: "Episode" }),
    "/item/episode-4",
  );
});
