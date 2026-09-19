import { useEffect, useMemo, useState } from "react";
import { useSession } from "../state/Session.jsx";
import { Shelf, Loading, ErrorBox, itemProgress, ProgressRing } from "../components/Cards.jsx";
import { IconFilm, IconTv, IconBroadcast, IconMusicNote } from "../components/Icons.jsx";
import { fmtRuntimeTicks } from "../api/utils.js";

const CATEGORIES = [
  { key: "Movies", label: "Movies", icon: IconFilm },
  { key: "Series", label: "TV Shows", icon: IconTv },
  { key: "LiveTV", label: "Live TV", icon: IconBroadcast, live: true, to: "/live-tv" },
  { key: "Music", label: "Music", icon: IconMusicNote },
];

const HERO_LIMIT = 6;
const HERO_ROTATION_MS = 9_000;

function makeHeroPool(home, arrivals) {
  const candidates = [
    ...(arrivals || []),
    ...(home?.Latest || []),
    ...(home?.ContinueWatching || []),
    ...(home?.NextUp || []),
  ];
  const seen = new Set();
  const unique = candidates.filter((item) => {
    if (!item?.Id || seen.has(item.Id)) return false;
    seen.add(item.Id);
    return true;
  });
  const movies = unique.filter((item) => item.Type === "Movie");
  const shows = unique.filter((item) => item.Type === "Series" || item.Type === "BoxSet");
  const mixed = [];

  // Interleave the two kinds so a run of newly-added films does not push
  // every show out of the showcase (and vice versa).
  for (let i = 0; mixed.length < HERO_LIMIT && (i < movies.length || i < shows.length); i += 1) {
    if (movies[i]) mixed.push(movies[i]);
    if (shows[i] && mixed.length < HERO_LIMIT) mixed.push(shows[i]);
  }
  // Older/unusual servers may omit Type; retain a graceful fallback without
  // mixing episodes, albums or tracks into a valid film-and-series pool.
  return mixed.length ? mixed : unique.slice(0, HERO_LIMIT);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

const clock = new Date().toLocaleDateString("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
}).toUpperCase();

/**
 * Home — the hero is the room's centerpiece.
 *
 * A full-bleed artwork of the featured title, breathing very slowly, with the
 * title set over it. Beneath: the shelves that actually matter — what you
 * were watching, what's up next, what's new.
 */
export function Home() {
  const { client, user } = useSession();
  const [home, setHome] = useState(undefined);
  const [arrivals, setArrivals] = useState(undefined);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    setHome(undefined);
    setArrivals(undefined);
    setError(null);
    (async () => {
      try {
        const [h, newItems] = await Promise.all([
          client.home(),
          client.items({
            SortBy: "DateAdded",
            SortOrder: "Descending",
            limit: 48,
            IncludeItemTypes: "Movie,Series",
            HasImage: true,
            EnableImages: true,
            Fields:
              "Overview,Genres,PrimaryImageAspectRatio,OriginalRuntimeTicks,ProductionYear,CommunityRating,BackdropImageTags",
          }),
        ]);
        if (!alive) return;
        setHome(h);
        setArrivals(newItems?.Items || []);
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client, tick]);

  const heroPool = useMemo(() => makeHeroPool(home, arrivals), [home, arrivals]);
  const heroPoolKey = heroPool.map((item) => item.Id).join(",");

  useEffect(() => {
    setHeroIndex(0);
  }, [heroPoolKey]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (heroPool.length < 2 || heroPaused || reduceMotion) return undefined;
    const timer = window.setInterval(() => {
      setHeroIndex((index) => (index + 1) % heroPool.length);
    }, HERO_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [heroPool.length, heroPaused, reduceMotion]);

  if (error) return <ErrorBox error={error} onRetry={retry} />;
  if (!home) return <Loading label="Setting the room" />;

  const hero = heroPool[heroIndex % Math.max(1, heroPool.length)];
  const heroUrl = hero ? client.image(hero, "Backdrop", { w: 1600, q: 85 }) : "";
  const heroFallbackUrl = hero ? client.image(hero, "Primary", { w: 1200, q: 85 }) : "";
  const heroSub = hero
    ? [
        hero.ProductionYear,
        hero.SeriesName,
        hero.SeasonName,
        fmtRuntimeTicks(hero.RunTimeTicks),
        hero.Genres?.[0],
      ]
        .filter(Boolean)
        .join("  ·  ")
    : "";

  return (
    <>
      {/* ------------------------------------------------ hero ------------- */}
      {hero && (
        <section
          className="hero reveal"
          aria-label="Featured"
          onMouseEnter={() => setHeroPaused(true)}
          onMouseLeave={() => setHeroPaused(false)}
          onFocus={() => setHeroPaused(true)}
          onBlur={() => setHeroPaused(false)}
        >
          {heroUrl && (
            <img
              key={hero.Id}
              className="hero-bg"
              src={heroUrl}
              alt=""
              onError={(event) => {
                if (heroFallbackUrl && event.currentTarget.src !== heroFallbackUrl) {
                  event.currentTarget.src = heroFallbackUrl;
                }
              }}
            />
          )}
          <div className="hero-scrim" />
          <div className="hero-inner" key={`copy-${hero.Id}`}>
            <div className="hero-kicker">
              {greeting()}
              {user?.Name ? ", " + user.Name : ""} · {clock}
            </div>
            <h1 className="hero-title">{hero.Name}</h1>
            {heroSub && <div className="hero-meta">{heroSub}</div>}
            {hero.Overview && <p className="hero-overview">{hero.Overview}</p>}
            <div className="hero-actions">
              <a className="btn btn-primary btn-play" href={`#/item/${hero.Id}?play=1`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
                {hero.Type === "Series" || hero.Type === "BoxSet" ? "Continue the series" : "Play"}
              </a>
              <a className="btn" href={`#/item/${hero.Id}`}>
                Details
              </a>
            </div>
          </div>
          {heroPool.length > 1 && (
            <div className="hero-pagination" aria-label="Choose featured title">
              {heroPool.map((item, index) => (
                <button
                  key={item.Id}
                  type="button"
                  className={index === heroIndex ? "active" : ""}
                  aria-label={`Show ${item.Name}`}
                  aria-current={index === heroIndex ? "true" : undefined}
                  onClick={() => setHeroIndex(index)}
                >
                  <span />
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------ categories ---------------------------- */}
      <nav className="cat-row reveal" aria-label="Browse by category">
        {CATEGORIES.map((c) => {
          const Icon = c.icon;
          return (
            <a key={c.key} className={`cat-tile ${c.live ? "cat-tile-live" : ""}`} href={`#${c.to || `/browse?type=${c.key}`}`}>
              <Icon size={22} />
              <span>{c.label}</span>
            </a>
          );
        })}
      </nav>

      {/* ------------------------------ shelves ------------------------------ */}
      <Shelf
        title="Pick up where you left off"
        items={home.ContinueWatching}
        client={client}
        empty="Everything's watched — the whole wall's yours."
        badge={(it) => <ProgressRing pct={itemProgress(it)} />}
        sub={(it) =>
          [it.SeriesName, it.SeasonName].filter(Boolean).join(" · ") ||
          fmtRuntimeTicks(it.RunTimeTicks)
        }
      />
      <Shelf
        title="Up next"
        items={home.NextUp}
        client={client}
        empty=""
        sub={(it) => [it.SeriesName, it.SeasonName].filter(Boolean).join(" · ")}
      />
      <Shelf
        title="New in your library"
        items={home.Latest?.length ? home.Latest : arrivals}
        client={client}
        empty=""
      />
    </>
  );
}
