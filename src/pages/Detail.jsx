import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../state/Session.jsx";
import { Loading, ErrorBox } from "../components/Cards.jsx";
import { Player } from "../components/Player.jsx";
import { fmtRuntimeTicks, ticksToSeconds, typeLabel, looksPlayable, isLiveTv } from "../api/utils.js";
import { isPlaybackComplete, playActionLabel, playbackExitPath } from "../components/playbackState.js";

/**
 * Detail — the single most important screen.
 *
 * A split hero (artwork left, data right), then the item's own overview,
 * people, and — for series — its seasons and episodes. For anything playable
 * it carries the transport into the player.
 */
export function Detail() {
  const { client } = useSession();
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [item, setItem] = useState(undefined);
  const [seasons, setSeasons] = useState(null);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [episodeQueue, setEpisodeQueue] = useState([]);
  const [seriesParent, setSeriesParent] = useState(null);
  const [seasonErrors, setSeasonErrors] = useState({});
  const [activeSeasonId, setActiveSeasonId] = useState("");
  const [tick, setTick] = useState(0);
  const autoplayed = useRef(false);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    setItem(undefined);
    setSeasons(null);
    setEpisodes({});
    setEpisodeQueue([]);
    setSeriesParent(null);
    setSeasonErrors({});
    setActiveSeasonId("");
    setError(null);
    setPlaying(null);
    autoplayed.current = false;
    (async () => {
      try {
        const it = await client.item(id);
        if (!alive) return;
        setItem(it);
        const seriesId = it?.Type === "Series" ? it.Id : it?.SeriesId;
        if (seriesId) {
          const [s, allEpisodes, parent] = await Promise.all([
            client.seasons(seriesId),
            client.seriesEpisodes(seriesId, { Limit: 1000 }),
            it.Type === "Series" ? Promise.resolve(it) : client.item(seriesId),
          ]);
          if (!alive) return;
          const seasonItems = s?.Items || [];
          const ordered = (allEpisodes?.Items || []).slice().sort((a, b) => {
            const seasonDiff = (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0);
            return seasonDiff || (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0);
          });
          setSeasons(seasonItems);
          setEpisodeQueue(ordered);
          setSeriesParent(parent);
          const itemSeasonId = it.SeasonId || it.ParentId;
          const requestedSeasonId = params.get("season");
          const initialSeason =
            seasonItems.find((season) => season.Id === itemSeasonId) ||
            seasonItems.find((season) => season.Id === requestedSeasonId) ||
            seasonItems.find((season) => (season.IndexNumber ?? 0) > 0) ||
            seasonItems[0];
          setActiveSeasonId(initialSeason?.Id || "");
          setEpisodes(
            ordered.reduce((grouped, episode) => {
              const seasonId = episode.SeasonId || episode.ParentId;
              if (!seasonId) return grouped;
              (grouped[seasonId] ||= []).push(episode);
              return grouped;
            }, {}),
          );
        }
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tick]);

  // Load episodes for a season on demand.
  const loadSeason = async (seasonId) => {
    if (episodes[seasonId]) return;
    setSeasonErrors((previous) => ({ ...previous, [seasonId]: null }));
    try {
      const out = await client.episodes(seasonId, { limit: 200 });
      setEpisodes((prev) => ({ ...prev, [seasonId]: out?.Items || [] }));
    } catch (e) {
      setSeasonErrors((previous) => ({ ...previous, [seasonId]: e }));
    }
  };

  const playable = looksPlayable(item);
  const isSeries = item?.Type === "Series";
  const isEpisode = item?.Type === "Episode";

  const play = useCallback(async () => {
    if (playable) {
      setPlaying(item);
      return;
    }
    // A series item itself can't be played — hand the player its next
    // unwatched episode instead (what "Continue the series" means).
    if (isSeries) {
      try {
        const out = await client.nextEpisodes(item.Id);
        const first = out?.Items?.[0];
        if (first) {
          setPlaying(first);
        }
      } catch (e) {
        setError(e);
      }
    }
  }, [client, isSeries, item, playable]);

  // A "Play" tap from elsewhere (e.g. the Home hero) can jump straight into
  // playback via ?play=1 instead of landing on this page inert. Keep this as
  // an effect: starting playback and setting state during render was prone to
  // duplicate work under React Strict Mode.
  useEffect(() => {
    if ((playable || isSeries) && params.get("play") === "1" && !autoplayed.current && !playing) {
      autoplayed.current = true;
      play();
    }
  }, [isSeries, params, play, playable, playing]);

  if (error) return <ErrorBox error={error} onRetry={retry} />;
  if (!item) return <Loading label="Opening the archive" />;

  const resumePosition = isLiveTv(item) ? 0 : ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  // The /Items response carries backdrop *tags*, not image objects — prefer
  // the tag list and fall back to the object shape for odd servers.
  const backdropItem = isEpisode && seriesParent ? seriesParent : item;
  const backdrops = backdropItem.BackdropImageTags || backdropItem.BackdropImages || [];
  const bg = backdrops[0]
    ? client.image(backdropItem, "Backdrop", { w: 1600, q: 85 })
    : client.image(backdropItem, "Primary", { w: 1200 });

  const episodeNumber = item.IndexNumber != null ? `Episode ${item.IndexNumber}` : "Episode";
  const seasonNumber = item.ParentIndexNumber != null
    ? item.ParentIndexNumber === 0 ? "Specials" : `Season ${item.ParentIndexNumber}`
    : item.SeasonName;
  const premiereDate = item.PremiereDate
    ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(item.PremiereDate))
    : "";

  const sub = [
    item.ProductionYear,
    isEpisode ? seasonNumber : item.SeriesName,
    isEpisode ? episodeNumber : item.SeasonName,
    fmtRuntimeTicks(item.RunTimeTicks),
    item.OfficialRating,
    item.CommunityRating ? `★ ${item.CommunityRating}` : "",
  ]
    .filter(Boolean)
    .join("  ·  ");

  const queueIndex = episodeQueue.findIndex((episode) => episode.Id === (playing?.Id || item.Id));
  const nextEpisode = queueIndex >= 0 ? episodeQueue[queueIndex + 1] || null : null;
  const currentEpisodeIndex = episodeQueue.findIndex((episode) => episode.Id === item.Id);
  const previousEpisode = currentEpisodeIndex > 0 ? episodeQueue[currentEpisodeIndex - 1] : null;
  const detailNextEpisode = currentEpisodeIndex >= 0 ? episodeQueue[currentEpisodeIndex + 1] || null : null;
  const currentSeason = seasons?.find((season) => season.Id === (item.SeasonId || item.ParentId));
  const defaultSeasonId = activeSeasonId || seasons?.find((season) => (season.IndexNumber ?? 0) > 0)?.Id || seasons?.[0]?.Id;
  const activeSeason = seasons?.find((season) => season.Id === activeSeasonId) || currentSeason;
  const activeSeasonEpisodes = activeSeason ? episodes[activeSeason.Id] : undefined;
  const mediaStreams = item.MediaSources?.[0]?.MediaStreams || [];
  const videoStream = mediaStreams.find((stream) => stream.Type === "Video");
  const audioStream = mediaStreams.find((stream) => stream.Type === "Audio");

  const playNext = async () => {
    if (!nextEpisode) return;
    try {
      const fullEpisode = await client.item(nextEpisode.Id);
      setPlaying(fullEpisode);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <section className="detail-hero reveal">
        {bg && <img className="bg" src={bg} alt="" />}
        <div className="scrim" />
        <div className="detail-head">
          <div className="hero-kicker">
            {isEpisode ? (
              <>
                <Link className="detail-series-link" to={`/item/${seriesParent?.Id || item.SeriesId}`}>
                  {seriesParent?.Name || item.SeriesName || "Series"}
                </Link>
                <span> / {seasonNumber} / {episodeNumber}</span>
              </>
            ) : (
              <>{typeLabel(item.Type)}{item.Status && ` · ${item.Status}`}</>
            )}
          </div>
          <h1 className="detail-title">{item.Name}</h1>
          {sub && <div className="detail-sub">{sub}</div>}
          {(playable || isSeries) && (
            <div className="hero-actions" style={{ marginTop: 22 }}>
              <button className="btn btn-primary btn-play" onClick={play}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
                {playActionLabel(item, { resumePosition })}
              </button>
              {isEpisode && previousEpisode && (
                <Link className="btn detail-episode-action" to={`/item/${previousEpisode.Id}`}>
                  Previous episode
                </Link>
              )}
              {isEpisode && detailNextEpisode && (
                <Link className="btn detail-episode-action" to={`/item/${detailNextEpisode.Id}`}>
                  Next episode
                </Link>
              )}
            </div>
          )}
        </div>
      </section>

      {isEpisode && seriesParent && (
        <nav className="series-path reveal" aria-label="Series navigation">
          <div className="series-path-copy">
            <span>{seasonNumber} · {episodeNumber}</span>
            <Link to={`/item/${seriesParent.Id}`}>{seriesParent.Name}</Link>
          </div>
          <div className="series-path-actions">
            {previousEpisode ? (
              <Link className="series-path-step" to={`/item/${previousEpisode.Id}`}>
                <small>Previous</small>
                <b>E{previousEpisode.IndexNumber ?? "–"} · {previousEpisode.Name}</b>
              </Link>
            ) : <span />}
            <a className="series-path-all" href="#episodes">
              Browse episodes
            </a>
            {detailNextEpisode ? (
              <Link className="series-path-step series-path-next" to={`/item/${detailNextEpisode.Id}`}>
                <small>Up next</small>
                <b>E{detailNextEpisode.IndexNumber ?? "–"} · {detailNextEpisode.Name}</b>
              </Link>
            ) : <span />}
          </div>
        </nav>
      )}

      <div className="detail-body reveal">
        <div>
          {item.Overview && <p className="detail-overview">{item.Overview}</p>}
          {item.Genres?.length > 0 && (
            <div className="genres">
              {item.Genres.map((g) => (
                <span className="genre-tag" key={g}>
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>

        {(item.People?.length > 0 || item.ProductionYear) && (
          <dl className="spec" style={{ margin: 0 }}>
            {item.ProductionYear && (
              <div className="spec-row">
                <dt>Year</dt>
                <dd>{item.ProductionYear}</dd>
              </div>
            )}
            {item.RunTimeTicks > 0 && (
              <div className="spec-row">
                <dt>Length</dt>
                <dd>{fmtRuntimeTicks(item.RunTimeTicks)}</dd>
              </div>
            )}
            {isEpisode && premiereDate && (
              <div className="spec-row">
                <dt>Aired</dt>
                <dd>{premiereDate}</dd>
              </div>
            )}
            {item.OfficialRating && (
              <div className="spec-row">
                <dt>Certificate</dt>
                <dd>{item.OfficialRating}</dd>
              </div>
            )}
            {item.CommunityRating > 0 && (
              <div className="spec-row">
                <dt>Rated</dt>
                <dd>{item.CommunityRating} / 10</dd>
              </div>
            )}
            {videoStream && (
              <div className="spec-row">
                <dt>Video</dt>
                <dd>{videoStream.DisplayTitle || [videoStream.Codec?.toUpperCase(), videoStream.Height ? `${videoStream.Height}p` : ""].filter(Boolean).join(" · ")}</dd>
              </div>
            )}
            {audioStream && (
              <div className="spec-row">
                <dt>Audio</dt>
                <dd>{audioStream.DisplayTitle || [audioStream.Codec?.toUpperCase(), audioStream.Channels ? `${audioStream.Channels} ch` : ""].filter(Boolean).join(" · ")}</dd>
              </div>
            )}
            {item.People?.slice(0, 6).map((p) => (
              <div className="spec-row" key={p.Id}>
                <dt>{p.Role || "Cast"}</dt>
                <dd>{p.Name}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* seasons & episodes for series */}
      {isSeries && seasons?.length > 0 && (
        <section className="seasons" aria-label="Seasons and episodes">
          <div className="seasons-heading">
            <div>
              <div className="page-eyebrow">Watch the series</div>
              <h2>Seasons &amp; episodes</h2>
            </div>
            <span>{seasons.length} {seasons.length === 1 ? "season" : "seasons"}</span>
          </div>
          {seasons.map((season) => (
            <SeasonBlock
              key={season.Id}
              season={season}
              client={client}
              episodes={episodes}
              load={loadSeason}
              loadError={seasonErrors[season.Id]}
              defaultOpen={season.Id === defaultSeasonId}
            />
          ))}
        </section>
      )}

      {isEpisode && activeSeason && (
        <section id="episodes" className="seasons episode-season" aria-label="Browse episodes">
          <div className="seasons-heading">
            <div>
              <div className="page-eyebrow">More from {seriesParent?.Name || item.SeriesName}</div>
              <h2>Episodes</h2>
            </div>
            <div className="episode-season-controls">
              <label htmlFor="episode-season-select">Season</label>
              <div className="select-wrap">
                <select
                  id="episode-season-select"
                  value={activeSeason.Id}
                  onChange={(event) => setActiveSeasonId(event.target.value)}
                >
                  {seasons.map((season) => (
                    <option key={season.Id} value={season.Id}>{season.Name || season.SeasonName}</option>
                  ))}
                </select>
              </div>
              <Link className="season-series-link" to={`/item/${seriesParent?.Id || item.SeriesId}`}>
                Show page
              </Link>
            </div>
          </div>
          <EpisodeBrowser
            season={activeSeason}
            client={client}
            episodes={activeSeasonEpisodes}
            load={loadSeason}
            loadError={seasonErrors[activeSeason.Id]}
            currentEpisodeId={item.Id}
          />
        </section>
      )}

      {playing && (
        <Player
          key={playing.Id}
          item={playing}
          nextItem={nextEpisode}
          onPlayNext={playNext}
          // A series autoplays one of *its* episodes, so resume from that
          // episode's own position, not the series' (nonexistent) one.
          initialPosition={
            isLiveTv(playing)
              ? 0
              : playing.Id === item.Id
                ? resumePosition
                : ticksToSeconds(playing.UserData?.PlaybackPositionTicks)
          }
          onClose={() => {
            const exitPath = playbackExitPath(item, playing);
            setPlaying(null);
            if (exitPath) {
              // Consecutive playback advances the player without changing the
              // detail route. Replace that stale route with the episode the
              // viewer actually reached before returning to the page.
              navigate(exitPath, { replace: true });
              return;
            }
            // Drop ?play=1 — otherwise closing the player re-runs autoplay on
            // the very next render and the player immediately opens again.
            if (params.get("play")) {
              const nextParams = new URLSearchParams(params);
              nextParams.delete("play");
              setParams(nextParams, { replace: true });
            }
            retry();
          }}
        />
      )}
    </>
  );
}

function EpisodeBrowser({ season, client, episodes, load, loadError, currentEpisodeId }) {
  const browserRef = useRef(null);

  useEffect(() => {
    load(season.Id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season.Id]);

  useEffect(() => {
    const rail = browserRef.current;
    const current = rail?.querySelector(`[data-episode-id="${currentEpisodeId}"]`);
    if (!rail || !current) return;
    const target = current.previousElementSibling || current;
    const offset = target.getBoundingClientRect().left - rail.getBoundingClientRect().left;
    rail.scrollLeft = Math.max(0, rail.scrollLeft + offset - 12);
  }, [currentEpisodeId, episodes, season.Id]);

  if (loadError) {
    return (
      <div className="season-empty season-error">
        <span>{loadError.message || "This season could not be loaded."}</span>
        <button className="btn" onClick={() => load(season.Id)}>Try again</button>
      </div>
    );
  }

  if (episodes === undefined) {
    return (
      <div className="season-loading" role="status">
        <div className="spinner" />
        <span>Loading this season</span>
      </div>
    );
  }

  if (episodes.length === 0) return <div className="season-empty">No episodes are available in this season.</div>;

  return (
    <div ref={browserRef} className="episode-list episode-browser-list">
      {episodes.map((episode) => (
        <EpisodeCard key={episode.Id} episode={episode} client={client} current={episode.Id === currentEpisodeId} />
      ))}
    </div>
  );
}

function SeasonBlock({ season, client, episodes, load, loadError, defaultOpen = false, currentEpisodeId }) {
  const [open, setOpen] = useState(defaultOpen);
  const eps = episodes[season.Id];
  const seasonName = season.SeasonName || season.Name || "Season";
  const seasonNumber = season.IndexNumber != null && season.IndexNumber > 0 ? season.IndexNumber : null;
  const seasonArt = season.PrimaryImageAspectRatio
    ? client.image(season, "Primary", { w: 240, h: 360, q: 82 })
    : "";
  const episodeCount = eps?.length ?? season.ChildCount;

  useEffect(() => {
    if (open) load(season.Id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <section className={`season-block ${open ? "open" : ""}`}>
      <button
        className="season-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="season-art" aria-hidden="true">
          {seasonArt ? <img src={seasonArt} alt="" loading="lazy" /> : <b>{seasonNumber ?? "S"}</b>}
        </span>
        <span className="season-copy">
          <span className="season-label">{seasonNumber ? `Season ${String(seasonNumber).padStart(2, "0")}` : "Special collection"}</span>
          <strong>{seasonName}</strong>
          <span className="season-count">
            {episodeCount != null
              ? `${episodeCount} ${episodeCount === 1 ? "episode" : "episodes"}`
              : open
                ? "Loading episodes"
                : "View episodes"}
          </span>
        </span>
        <span className="season-chevron" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m7 10 5 5 5-5" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="episode-list">
          {loadError ? (
            <div className="season-empty season-error">
              <span>{loadError.message || "This season could not be loaded."}</span>
              <button className="btn" onClick={() => load(season.Id)}>Try again</button>
            </div>
          ) : eps === undefined ? (
            <div className="season-loading" role="status">
              <div className="spinner" />
              <span>Loading this season</span>
            </div>
          ) : eps.length === 0 ? (
            <div className="season-empty">No episodes are available in this season.</div>
          ) : (
            eps.map((ep) => (
              <EpisodeCard key={ep.Id} episode={ep} client={client} current={ep.Id === currentEpisodeId} />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function EpisodeCard({ episode, client, current = false }) {
  const position = episode.UserData?.PlaybackPositionTicks || 0;
  const runtime = episode.RunTimeTicks || 0;
  const progress = runtime > 0 ? Math.min(1, position / runtime) : 0;
  const watched = isPlaybackComplete(episode);
  const art = episode.PrimaryImageAspectRatio
    ? client.image(episode, "Primary", { w: 560, h: 315, q: 82 })
    : "";

  return (
    <article data-episode-id={episode.Id} className={`episode-card ${current ? "episode-card-current" : ""}`}>
      <Link className="episode-art" to={`/item/${episode.Id}?play=1`} aria-label={`${watched ? "Replay watched" : "Play"} ${episode.Name}`}>
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="episode-no-art" aria-hidden="true">E{episode.IndexNumber || "–"}</span>
        )}
        <span className="episode-art-play" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
        </span>
        {progress > 0 && !watched && (
          <span className="episode-progress" aria-label={`${Math.round(progress * 100)}% watched`}>
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </Link>

      <div className="episode-copy">
        <div className="episode-kicker">
          <span>Episode {episode.IndexNumber || "–"}</span>
          {current && <span className="episode-current">Now viewing</span>}
          {watched && <span className="episode-watched">Watched</span>}
        </div>
        <Link className="episode-title" to={`/item/${episode.Id}`}>{episode.Name || "Untitled episode"}</Link>
        {episode.Overview && <p className="episode-overview">{episode.Overview}</p>}
        <div className="episode-meta">
          {episode.RunTimeTicks > 0 && <span>{fmtRuntimeTicks(episode.RunTimeTicks)}</span>}
          {episode.ProductionYear && <span>{episode.ProductionYear}</span>}
          {episode.CommunityRating > 0 && <span>★ {episode.CommunityRating}</span>}
        </div>
      </div>

      <Link className="episode-play" to={`/item/${episode.Id}?play=1`} aria-label={`${watched ? "Replay watched" : "Play"} ${episode.Name}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
        <span>{playActionLabel(episode)}</span>
      </Link>
    </article>
  );
}
