import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { useSession } from "../state/Session.jsx";
import { Grid, Loading, ErrorBox, LiveBadge } from "../components/Cards.jsx";
import { IconLibrary, IconFilm, IconTv, IconBroadcast, IconMusicNote } from "../components/Icons.jsx";

const TYPE_FILTERS = [
  { key: "All", label: "Everything", value: "", icon: IconLibrary, exclude: "TvChannel" },
  { key: "Movies", label: "Movies", value: "Movie", icon: IconFilm },
  { key: "Series", label: "TV Shows", value: "Series,BoxSet", icon: IconTv },
  { key: "LiveTV", label: "Live TV", value: "TvChannel", icon: IconBroadcast, live: true },
  { key: "Music", label: "Music", value: "Audio,MusicAlbum,Artist,MusicVideo", icon: IconMusicNote },
];

const SORTS = [
  { key: "recent", label: "Newest", sortBy: "DateAdded", sortOrder: "Descending" },
  { key: "az", label: "A–Z", sortBy: "SortName", sortOrder: "Ascending" },
  { key: "year", label: "Year", sortBy: "ProductionYear", sortOrder: "Descending" },
  { key: "rating", label: "Rated", sortBy: "CommunityRating", sortOrder: "Descending" },
];

const PAGE = 48;

/**
 * Browse — the library as a browsable wall.
 *
 * A filter rail on top (what to see), a sort control, and a dense grid that
 * paginates lazily. It's the room's archive: everything, addressable.
 * Live TV, Movies and TV Shows are kept as distinct rooms rather than one
 * mixed pile — channels never bleed into "Everything". The active category
 * lives in the URL (?type=Movies) so Home's category tiles can link straight in.
 */
export function Browse() {
  const { client } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialType = TYPE_FILTERS.some((t) => t.key === params.get("type")) ? params.get("type") : "Movies";
  const [type, setTypeState] = useState(initialType);
  const [sort, setSort] = useState("recent");
  const [items, setItems] = useState(undefined);
  const [start, setStart] = useState(0);
  const [total, setTotal] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const retry = () => setTick((t) => t + 1);

  const setType = (key) => {
    setTypeState(key);
    setParams(key === "Movies" ? {} : { type: key }, { replace: true });
  };

  const activeType = TYPE_FILTERS.find((t) => t.key === type) || TYPE_FILTERS[0];
  const sortOptions = activeType.live ? SORTS.filter((s) => s.key === "recent" || s.key === "az") : SORTS;
  const activeSort = sortOptions.find((s) => s.key === sort) || sortOptions[0];

  useEffect(() => {
    let alive = true;
    setItems(undefined);
    setError(null);
    setStart(0);
    (async () => {
      try {
        const out = await client.items({
          IncludeItemTypes: activeType.value,
          ExcludeItemTypes: activeType.exclude,
          Recursive: true,
          SortBy: activeSort.sortBy,
          SortOrder: activeSort.sortOrder,
          limit: PAGE,
          start_index: 0,
          EnableTotalRecordCount: true,
          Fields: "PrimaryImageAspectRatio,ProductionYear,CommunityRating,RunTimeTicks,Status,Genres",
        });
        if (!alive) return;
        setItems(out?.Items || []);
        setTotal(out?.TotalRecordCount);
      } catch (e) {
        if (alive) setError(e);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, sort, tick]);

  const loadMore = async () => {
    if (!items || loadingMore) return;
    setStart(items.length);
    setLoadingMore(true);
    try {
      const out = await client.items({
        IncludeItemTypes: activeType.value,
        ExcludeItemTypes: activeType.exclude,
        Recursive: true,
        SortBy: activeSort.sortBy,
        SortOrder: activeSort.sortOrder,
        limit: PAGE,
        start_index: items.length,
        Fields: "PrimaryImageAspectRatio,ProductionYear,CommunityRating,RunTimeTicks,Status,Genres",
      });
      setItems((prev) => (prev || []).concat(out?.Items || []));
    } catch (e) {
      setError(e);
    } finally {
      setLoadingMore(false);
    }
  };
  const [loadingMore, setLoadingMore] = useState(false);

  if (error && !items) return <ErrorBox error={error} onRetry={retry} />;
  if (!items) return <Loading label="Gathering the archive" />;

  return (
    <>
      <div className="page-heading reveal">
        <div className="page-eyebrow">Your Jellyfin library</div>
        <div className="page-title-row">
          <h1>{activeType.label}</h1>
          {total != null && <span>{total.toLocaleString()} items</span>}
        </div>
      </div>

      <div className="filterbar">
        {TYPE_FILTERS.map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              className={`chip ${type === f.key ? "on" : ""} ${f.live ? "chip-live" : ""}`}
              onClick={() => {
                if (f.live) {
                  navigate("/live-tv");
                  return;
                }
                setType(f.key);
                setSort("recent");
              }}
            >
              {Icon && <Icon size={14} />}
              {f.label}
            </button>
          );
        })}
        <div className="select-wrap" style={{ marginLeft: "auto" }}>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            {sortOptions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="search-empty">
          <b>Nothing here yet</b>
          No {activeType.label.toLowerCase()} have been added to this server so far.
        </div>
      ) : (
        <Grid
          title=""
          items={items}
          client={client}
          sub={(it) =>
            activeType.live
              ? it.Number
                ? `Channel ${it.Number}`
                : "Live TV"
              : undefined
          }
          badge={(it) => (it.Type === "TvChannel" ? <LiveBadge /> : undefined)}
        />
      )}

      {total != null && items.length < total && (
        <div style={{ textAlign: "center", marginTop: 28 }}>
          <button className="btn" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : `Load more (${(total - items.length).toLocaleString()} remaining)`}
          </button>
        </div>
      )}
    </>
  );
}
