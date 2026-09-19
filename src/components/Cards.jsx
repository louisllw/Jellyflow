import { Link } from "react-router-dom";
import { posterRatio, typeLabel, fmtRuntime } from "../api/utils.js";

function fallbackArt(item) {
  const name = item?.Name || "—";
  return (
    <div className="no-art" aria-hidden>
      <span style={{ fontFamily: "var(--font-display)", fontSize: 30, fontWeight: 700, color: "var(--ink-faint)" }}>
        {name.charAt(0).toUpperCase() || "·"}
      </span>
    </div>
  );
}

// One item as a card. Portrait poster or landscape card, chosen from the
// artwork's native aspect ratio — that mix is what makes a shelf read as a
// media wall rather than a uniform grid.
export function Card({ item, client, sub, badge }) {
  const name = item?.Name || "";
  const landscape = posterRatio(item) === "landscape";
  const art = client ? client.image(item, "Primary", { w: landscape ? 480 : 320, h: landscape ? 270 : 420 }) : "";

  return (
    <Link to={`/item/${item?.Id}`} className={`card reveal ${landscape ? "card-landscape" : "card-portrait"}`}>
      {art ? <img src={art} alt={name} loading="lazy" /> : fallbackArt(item)}
      {badge}
      <div className="card-cap">
        <div className="card-name">{name}</div>
        <div className="card-sub">
          {sub || typeLabel(item?.Type) + (item?.ProductionYear ? " · " + item.ProductionYear : "")}
        </div>
      </div>
    </Link>
  );
}

// A horizontal row of cards — the signature "shelf".
export function Shelf({ title, items, client, sub, badge, empty }) {
  if (!items || !items.length) {
    if (!empty) return null;
  }
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <div className="section-rule" />
      </div>
      {items && items.length ? (
        <div className="shelf">
          {items.map((it) => (
            <Card key={it.Id} item={it} client={client} sub={typeof sub === "function" ? sub(it) : sub} badge={typeof badge === "function" ? badge(it) : badge} />
          ))}
        </div>
      ) : (
        <div className="search-empty" style={{ padding: "40px 0" }}>
          {empty || "Nothing here yet."}
        </div>
      )}
    </section>
  );
}

// The dense wall used by Browse and Search.
export function Grid({ title, items, client, sub, badge, empty }) {
  if (!items || !items.length) {
    if (empty) return <div className="search-empty">{empty}</div>;
    return null;
  }
  return (
    <section className="section" style={{ marginTop: 0 }}>
      {title ? (
        <div className="section-head">
          <h2 className="section-title">{title}</h2>
          <div className="section-rule" />
        </div>
      ) : null}
      <div className="grid">
        {items.map((it) => (
          <Card
            key={it.Id}
            item={it}
            client={client}
            sub={typeof sub === "function" ? sub(it) : sub}
            badge={typeof badge === "function" ? badge(it) : badge}
          />
        ))}
      </div>
    </section>
  );
}

// The pulsing dot that marks a live, always-on channel rather than a fixed asset.
export function LiveBadge() {
  return (
    <span className="card-badge card-badge-live">
      <span className="live-dot" />
      LIVE
    </span>
  );
}

export function Loading({ label = "Loading" }) {
  return (
    <div className="loadwrap" role="status">
      <div className="spinner" style={{ margin: "0 auto" }} />
      <div style={{ marginTop: 14, fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
        {label}
      </div>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="errwrap">
      <b>Something didn't load</b>
      <div style={{ marginBottom: 18, maxWidth: 480, margin: "0 auto 18px" }}>{error?.message || "An unexpected error occurred."}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

// A small progress ring for "continue watching" items, keyed to the
// item's user-data playback position.
export function ProgressRing({ pct }) {
  if (!pct || pct <= 0) return null;
  return (
    <span className="card-badge" style={pct > 0.92 ? { color: "var(--ink-faint)" } : undefined}>
      <span className="ring" style={{ "--p": Math.min(0.99, pct) }} />
      {pct > 0.92 ? "watched" : `${Math.round(pct * 100)}%`}
    </span>
  );
}

export function itemProgress(item) {
  const ud = item?.UserData;
  const ticks = ud?.PlaybackPositionTicks || 0;
  const total = item?.RunTimeTicks || 0;
  if (!total || ticks <= 0) return 0;
  if (ud?.Played) return 1;
  return Math.min(0.99, ticks / total);
}
