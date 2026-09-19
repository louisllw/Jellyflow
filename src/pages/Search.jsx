import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../state/Session.jsx";
import { Grid, ErrorBox, LiveBadge } from "../components/Cards.jsx";
import { IconTv, IconFilm, IconBroadcast } from "../components/Icons.jsx";

const DEBOUNCE = 300;
const FILTERS = [
  { key: "Series", label: "TV shows", types: "Series", icon: IconTv },
  { key: "Movies", label: "Movies", types: "Movie", icon: IconFilm },
  { key: "LiveTV", label: "Live TV", types: "TvChannel", icon: IconBroadcast },
];

/**
 * Search — only top-level destinations, never individual seasons.
 * With no filter selected, shows, movies and live channels are all included.
 */
export function Search() {
  const { client } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const requestedType = params.get("type") || "";
  const active = FILTERS.find((filter) => filter.key === requestedType) || null;

  const [items, setItems] = useState(undefined);
  const [total, setTotal] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const timer = useRef(null);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    clearTimeout(timer.current);
    if (!q.trim()) {
      setItems(undefined);
      setTotal(null);
      setSearching(false);
      setError(null);
      return () => {
        alive = false;
      };
    }
    setSearching(true);
    setError(null);
    timer.current = setTimeout(async () => {
      try {
        const out = await client.search(q.trim(), {
          includeItemTypes: active?.types,
          Limit: 60,
        });
        if (!alive) return;
        setItems(out?.Items || []);
        setTotal(out?.TotalRecordCount ?? out?.Items?.length ?? 0);
      } catch (e) {
        if (!alive) return;
        setError(e);
        setItems([]);
      } finally {
        if (alive) setSearching(false);
      }
    }, DEBOUNCE);
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [q, active?.types, client, tick]);

  const selectFilter = (key) => {
    const next = new URLSearchParams(params);
    if (active?.key === key) next.delete("type");
    else next.set("type", key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <div className="page-heading page-heading-compact reveal">
        <div className="page-eyebrow">Across your library</div>
        <div className="page-title-row">
          <h1>{q.trim() ? `Results for “${q}”` : "Search"}</h1>
          {q.trim() && total != null && !searching && <span>{total.toLocaleString()} {total === 1 ? "match" : "matches"}</span>}
        </div>
      </div>

      <div className="search-filters" aria-label="Filter search results">
        {FILTERS.map((filter) => {
          const Icon = filter.icon;
          const selected = active?.key === filter.key;
          return (
            <button
              key={filter.key}
              className={`search-filter ${selected ? "on" : ""}`}
              onClick={() => selectFilter(filter.key)}
              aria-pressed={selected}
            >
              <Icon size={15} />
              {filter.label}
            </button>
          );
        })}
        <span className="search-filter-state">{active ? `Showing ${active.label}` : "Showing all three"}</span>
      </div>

      {!q.trim() ? (
        <div className="search-empty">
          <b>Search shows, movies and live TV</b>
          Type above, then narrow the results if you need to.
        </div>
      ) : items === undefined ? (
        <div className="loadwrap" role="status">
          <div className="spinner" />
        </div>
      ) : error ? (
        <ErrorBox error={error} onRetry={retry} />
      ) : items.length === 0 ? (
        <div className="search-empty">
          <b>Nothing for “{q}”</b>
          {active ? `Try another title or clear the ${active.label} filter.` : "Try a title or a looser word."}
        </div>
      ) : (
        <div className={searching ? "search-results-searching" : ""} aria-busy={searching}>
          <Grid
            title=""
            items={items}
            client={client}
            sub={(item) => item.Type === "TvChannel" ? (item.Number ? `Channel ${item.Number}` : "Live TV") : undefined}
            badge={(item) => item.Type === "TvChannel" ? <LiveBadge /> : undefined}
          />
        </div>
      )}
    </>
  );
}
