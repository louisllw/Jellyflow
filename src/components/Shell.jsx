import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../state/Session.jsx";
import { IconHome, IconLibrary, IconSearch, IconSettings, IconExit, IconBack, IconBroadcast } from "../components/Icons.jsx";
import { hostOf } from "../api/jellyfin.js";

/**
 * The room's architecture: a thin icon rail at the left edge, a quiet top
 * strip (where search lives), and the page itself. Nothing else.
 *
 * On every route the search strip is present; typing navigates to /search
 * and keeps the term in the URL so results are shareable.
 */
export function Shell({ children }) {
  const { cfg, user, disconnect } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const onSearch = location.pathname === "/search";
  const [q, setQ] = useState(onSearch ? params.get("q") || "" : "");

  // Keep the local field in step with the URL: back/forward, opening the
  // search rail while already on /search, and a fresh ?q=… from a shared
  // link all land in the field — not only on pathname changes.
  useEffect(() => {
    setQ(onSearch ? params.get("q") || "" : "");
  }, [onSearch, params]);

  const type = (v) => {
    setQ(v);
    if (v) navigate("/search?q=" + encodeURIComponent(v), { replace: onSearch });
  };

  const goBack = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) {
      navigate(-1);
      return;
    }
    navigate(location.pathname.startsWith("/item/") ? "/browse" : "/");
  };

  const initials = (user?.Name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <div className="rail-mark" title="Jellyflow" aria-label="Jellyflow" />
        <NavLink to="/" end title="Home" className={({ isActive }) => (isActive ? "active" : "")}>
          <IconHome />
        </NavLink>
        <NavLink to="/browse" title="Library" className={({ isActive }) => (isActive ? "active" : "")}>
          <IconLibrary />
        </NavLink>
        <NavLink to="/live-tv" title="Live TV" className={({ isActive }) => (isActive ? "active" : "")}>
          <IconBroadcast />
        </NavLink>
        <NavLink to="/search" title="Search" className={({ isActive }) => (isActive ? "active" : "")}>
          <IconSearch />
        </NavLink>

        <div className="rail-spacer" />

        <NavLink to="/settings" title="Settings" className={({ isActive }) => (isActive ? "active" : "")}>
          <IconSettings />
        </NavLink>
        <button
          title="Sign out"
          aria-label="Sign out"
          onClick={() => {
            if (window.confirm("Sign out of Jellyflow on this device?")) disconnect();
          }}
        >
          <IconExit />
        </button>
        <span
          className="rail-user"
          title={user?.Name}
        >
          {initials}
        </span>
      </nav>

      <div className="main">
        <div className="topline">
          {location.pathname !== "/" && (
            <button className="topline-back" onClick={goBack} aria-label="Back">
              <IconBack size={18} />
            </button>
          )}
          <div className="crumb" style={{ visibility: onSearch ? "visible" : "hidden" }}>
            {onSearch ? "Searching the library" : ""}
          </div>
          <label className={`topline-search ${onSearch ? "topline-search-active" : ""}`} htmlFor="jf-search">
            <IconSearch size={15} />
            <input
              id="jf-search"
              type="search"
              placeholder="Search films, series, music…"
              value={q}
              onChange={(e) => type(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>

        {children}

        <footer className="foot">
          <span>
            <b>{user?.Name}</b> @ {hostOf(cfg?.serverUrl)}
          </span>
          <span style={{ marginLeft: "auto" }}>Jellyflow · your Jellyfin, reframed</span>
        </footer>
      </div>
    </div>
  );
}
