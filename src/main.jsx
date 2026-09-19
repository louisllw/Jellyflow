import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Routes, Route, Navigate, useSearchParams } from "react-router-dom";
import "./styles.css";
import { SessionProvider, useSession } from "./state/Session.jsx";
import { loadLastServer } from "./api/jellyfin.js";
import { Shell } from "./components/Shell.jsx";
import { Home } from "./pages/Home.jsx";
import { Browse } from "./pages/Browse.jsx";
import { Detail } from "./pages/Detail.jsx";
import { Search } from "./pages/Search.jsx";
import { Settings } from "./pages/Settings.jsx";
import { LiveTv } from "./pages/LiveTv.jsx";
import { Connect, SessionLost } from "./pages/Connect.jsx";

/**
 * Root. No session → the connect screen. A valid session → the room.
 * Hash routing keeps the whole app one static bundle: it runs on any
 * host, behind any reverse proxy, with no URL-rewrite rules.
 */
function App() {
  const { ready, booting, authError, disconnect, cfg, configuredServer } = useSession();

  if (booting) {
    return (
      <div className="connect">
        <div className="connect-card" style={{ textAlign: "center", display: "grid", placeItems: "center", gap: 18 }}>
          <div className="connect-mark" style={{ margin: 0 }} />
          <div className="spinner" style={{ margin: "0 auto" }} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.14em", color: "var(--ink-faint)" }}>
            WAKING THE SERVER
          </div>
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <SessionLost
        error={authError}
        onReset={() => {
          disconnect();
        }}
      />
    );
  }

  if (!ready) {
    // A runtime-configured server is authoritative. Otherwise, prefill from a
    // shared link or the last server used by this browser.
    const params = new URLSearchParams(window.location.search);
    const prefill = configuredServer || params.get("server") || cfg?.serverUrl || loadLastServer();
    return (
      <HashRouter>
        <Connect prefill={prefill} />
      </HashRouter>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Shell>
              <Home />
            </Shell>
          }
        />
        <Route
          path="/browse"
          element={
            <Shell>
              <Browse />
            </Shell>
          }
        />
        <Route
          path="/live-tv"
          element={
            <Shell>
              <LiveTv />
            </Shell>
          }
        />
        <Route
          path="/item/:id"
          element={
            <Shell>
              <Detail />
            </Shell>
          }
        />
        <Route
          path="/search"
          element={
            <Shell>
              <Search />
            </Shell>
          }
        />
        <Route
          path="/settings"
          element={
            <Shell>
              <Settings />
            </Shell>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);

// The ambient layer lives above everything, including the player.
document.body.insertAdjacentHTML("beforeend", '<div class="grain" aria-hidden="true"></div>');

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}
