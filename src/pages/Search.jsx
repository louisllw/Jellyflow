import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSession } from "../state/Session.jsx";
import { Grid, Loading, ErrorBox } from "../components/Cards.jsx";

const DEBOUNCE = 300;

/**
 * Search — one field, the whole library.
 *
 * The term lives in the URL (?q=…) so results are shareable and the top
 * strip's input stays in sync with this page. Debounced and live: start
 * typing anywhere and the wall below refills.
 */
export function Search() {
  const { client } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";

  const [items, setItems] = useState(undefined);
  const [total, setTotal] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const timer = useRef(null);
  const retry = () => setTick((t) => t + 1);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) {
      setItems(undefined);
      setTotal(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const out = await client.search(q.trim(), { Limit: 60 });
        setItems(out?.SearchHints || []);
        setTotal(out?.TotalRecordCount);
        setError(null);
      } catch (e) {
        setError(e);
        setItems([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE);
    return () => clearTimeout(timer.current);
  }, [q, client, tick]);

  return (
    <>
      <div className="page-heading page-heading-compact reveal">
        <div className="page-eyebrow">Across your library</div>
        <div className="page-title-row">
          <h1>{q.trim() ? `Results for “${q}”` : "Search"}</h1>
          {q.trim() && total != null && <span>{total.toLocaleString()} {total === 1 ? "match" : "matches"}</span>}
        </div>
      </div>

      {!q.trim() ? (
        <div className="search-empty">
          <b>Search the whole library</b>
          Films, series, episodes, music — type above.
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
          Try a title, an artist, or a looser word.
        </div>
      ) : (
        <Grid title="" items={items} client={client} />
      )}
    </>
  );
}
