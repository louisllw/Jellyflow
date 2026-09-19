import { useEffect, useRef, useState } from "react";
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
  const [params] = useSearchParams();
  const [item, setItem] = useState(undefined);
  const [seasons, setSeasons] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [episodes, setEpisodes] = useState({});
  const [tick, setTick] = useState(0);
  const autoplayed = useRef(false);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    setItem(undefined);
    setSeasons(null);
    setPeople([]);
    setEpisodes({});
    setError(null);
    setPlaying(null);
    autoplayed.current = false;
    (async () => {
      try {
        const it = await client.item(id);
        if (!alive) return;
        setItem(it);
        const cast = (it?.People || []).filter((p) => p.Type === "Person");
        setPeople(cast.slice(0, 8));
        if (it?.Type === "Series" || it?.Type === "BoxSet") {
          const s = await client.seasons(id);
          if (!alive) return;
          setSeasons(s?.Items || []);
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
    try {
      const out = await client.episodes(seasonId, { limit: 200 });
      setEpisodes((prev) => ({ ...prev, [seasonId]: out?.Items || [] }));
    } catch {}
  };

  if (error) return <ErrorBox error={error} onRetry={retry} />;
  if (!item) return <Loading label="Opening the archive" />;

  const playable = looksPlayable(item);
  const resumePosition = isLiveTv(item) ? 0 : ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  const backdrops = item.BackdropImages || [];
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

  const play = () => {
    if (!playable) return;
    client.startPlayback(item).catch(() => {});
    setPlaying(item);
  };

  // A "Play" tap from elsewhere (e.g. the Home hero) can jump straight into
  // playback via ?play=1 instead of landing on this page inert.
  if (playable && params.get("play") === "1" && !autoplayed.current && !playing) {
    autoplayed.current = true;
    play();
  }

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
          {playable && (
            <div className="hero-actions" style={{ marginTop: 22 }}>
              <button className="btn btn-primary btn-play" onClick={play}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
                {resumePosition > 30 ? `Resume at ${fmtClock(resumePosition)}` : "Play"}
              </button>
            </div>
          )}
        </div>
      </section>

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
      {seasons?.length > 0 && (
        <section className="seasons" aria-label="Seasons and episodes">
          <div className="seasons-heading">
            <div>
              <div className="page-eyebrow">Watch the series</div>
              <h2>Seasons &amp; episodes</h2>
            </div>
            <span>{seasons.length} {seasons.length === 1 ? "season" : "seasons"}</span>
          </div>
          {seasons.map((season, index) => (
            <SeasonBlock
              key={season.Id}
              season={season}
              client={client}
              episodes={episodes}
              load={loadSeason}
              defaultOpen={index === 0}
            />
          ))}
        </section>
      )}

      {playing && (
        <Player item={playing} initialPosition={resumePosition} onClose={() => { setPlaying(null); retry(); }} />
      )}
    </>
  );
}

function SeasonBlock({ season, client, episodes, load, defaultOpen = false }) {
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
          {eps === undefined ? (
            <div className="season-loading" role="status">
              <div className="spinner" />
              <span>Loading this season</span>
            </div>
          ) : eps.length === 0 ? (
            <div className="season-empty">No episodes are available in this season.</div>
          ) : (
            eps.map((ep) => (
              <EpisodeCard key={ep.Id} episode={ep} client={client} />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function EpisodeCard({ episode, client }) {
  const position = episode.UserData?.PlaybackPositionTicks || 0;
  const runtime = episode.RunTimeTicks || 0;
  const progress = runtime > 0 ? Math.min(1, position / runtime) : 0;
  const watched = Boolean(episode.UserData?.Played);
  const art = episode.PrimaryImageAspectRatio
    ? client.image(episode, "Primary", { w: 560, h: 315, q: 82 })
    : "";

  return (
    <article className="episode-card">
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
