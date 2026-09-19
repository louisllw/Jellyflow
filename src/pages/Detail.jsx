import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../state/Session.jsx";
import { Loading, ErrorBox } from "../components/Cards.jsx";
import { Player } from "../components/Player.jsx";
import { fmtClock, fmtRuntimeTicks, ticksToSeconds, typeLabel, looksPlayable, isLiveTv } from "../api/utils.js";

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
  const [params, setParams] = useSearchParams();
  const [item, setItem] = useState(undefined);
  const [seasons, setSeasons] = useState(null);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [episodeQueue, setEpisodeQueue] = useState([]);
  const [seriesParent, setSeriesParent] = useState(null);
  const [seasonErrors, setSeasonErrors] = useState({});
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
      client.startPlayback(item).catch(() => {});
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
          client.startPlayback(first).catch(() => {});
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
  const backdrops = item.BackdropImageTags || item.BackdropImages || [];
  const bg = backdrops[0]
    ? client.image({ Id: id }, "Backdrop", { w: 1600, q: 85 })
    : client.image(item, "Primary", { w: 1200 });

  const sub = [
    item.ProductionYear,
    item.SeriesName,
    item.SeasonName,
    fmtRuntimeTicks(item.RunTimeTicks),
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
  const selectedSeasonId = params.get("season");
  const defaultSeasonId = selectedSeasonId || seasons?.find((season) => (season.IndexNumber ?? 0) > 0)?.Id || seasons?.[0]?.Id;

  const playNext = async () => {
    if (!nextEpisode) return;
    try {
      const fullEpisode = await client.item(nextEpisode.Id);
      client.startPlayback(fullEpisode).catch(() => {});
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
            {typeLabel(item.Type)}
            {item.Status && ` · ${item.Status}`}
          </div>
          <h1 className="detail-title">{item.Name}</h1>
          {sub && <div className="detail-sub">{sub}</div>}
          {(playable || isSeries) && (
            <div className="hero-actions" style={{ marginTop: 22 }}>
              <button className="btn btn-primary btn-play" onClick={play}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
                {playable
                  ? resumePosition > 30
                    ? `Resume at ${fmtClock(resumePosition)}`
                    : "Play"
                  : "Play next episode"}
              </button>
            </div>
          )}
        </div>
      </section>

      {isEpisode && seriesParent && (
        <nav className="series-path reveal" aria-label="Series navigation">
          <div className="series-path-copy">
            <span>{item.SeasonName || `Season ${item.ParentIndexNumber || ""}`}</span>
            <Link to={`/item/${seriesParent.Id}`}>{seriesParent.Name}</Link>
          </div>
          <div className="series-path-actions">
            {previousEpisode ? (
              <Link className="series-path-step" to={`/item/${previousEpisode.Id}`}>
                <small>Previous</small>
                <b>E{previousEpisode.IndexNumber ?? "–"} · {previousEpisode.Name}</b>
              </Link>
            ) : <span />}
            <Link className="series-path-all" to={`/item/${seriesParent.Id}${currentSeason ? `?season=${currentSeason.Id}` : ""}`}>
              All seasons
            </Link>
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
            {item.CommunityRating > 0 && (
              <div className="spec-row">
                <dt>Rated</dt>
                <dd>{item.CommunityRating} / 10</dd>
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

      {isEpisode && currentSeason && (
        <section className="seasons episode-season" aria-label={`Episodes in ${currentSeason.Name}`}>
          <div className="seasons-heading">
            <div>
              <div className="page-eyebrow">Keep watching</div>
              <h2>{currentSeason.Name || item.SeasonName || "This season"}</h2>
            </div>
            <Link className="season-series-link" to={`/item/${seriesParent?.Id || item.SeriesId}`}>
              View every season
            </Link>
          </div>
          <SeasonBlock
            season={currentSeason}
            client={client}
            episodes={episodes}
            load={loadSeason}
            loadError={seasonErrors[currentSeason.Id]}
            defaultOpen
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
            // Drop ?play=1 — otherwise closing the player re-runs autoplay on
            // the very next render and the player immediately opens again.
            if (params.get("play")) {
              const nextParams = new URLSearchParams(params);
              nextParams.delete("play");
              setParams(nextParams, { replace: true });
            }
            setPlaying(null);
            retry();
          }}
        />
      )}
    </>
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
  const watched = Boolean(episode.UserData?.Played);
  const art = episode.PrimaryImageAspectRatio
    ? client.image(episode, "Primary", { w: 560, h: 315, q: 82 })
    : "";

  return (
    <article className={`episode-card ${current ? "episode-card-current" : ""}`}>
      <Link className="episode-art" to={`/item/${episode.Id}?play=1`} aria-label={`Play ${episode.Name}`}>
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

      <Link className="episode-play" to={`/item/${episode.Id}?play=1`} aria-label={`Play ${episode.Name}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
        <span>Play</span>
      </Link>
    </article>
  );
}
