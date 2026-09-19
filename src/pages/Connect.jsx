import { useEffect, useState } from "react";
import { useSession } from "../state/Session.jsx";
import {
  hostOf,
  initiateQuickConnect,
  quickConnectAvailable,
  quickConnectStatus,
  userAvatarUrl,
} from "../api/jellyfin.js";

/**
 * The front door. A deployment may pin one Jellyfin server at runtime;
 * otherwise the person signing in chooses their server here.
 */
export function Connect({ prefill, existingError }) {
  const { connect, connectWithApiKey, connectWithQuickConnect, listApiKeyUsers, configuredServer, configuredServerName } = useSession();
  const [mode, setMode] = useState("password"); // "password" | "quick" | "apikey"
  const [server, setServer] = useState(configuredServer || prefill || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [profiles, setProfiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(existingError || null);
  const [quickRequest, setQuickRequest] = useState(null);

  useEffect(() => {
    if (!quickRequest?.Secret) return undefined;
    let alive = true;
    let timer;
    const poll = async () => {
      try {
        const status = await quickConnectStatus(configuredServer || server, quickRequest.Secret);
        if (!alive) return;
        if (status?.Authenticated) {
          setBusy(true);
          await connectWithQuickConnect(configuredServer || server, quickRequest.Secret);
          return;
        }
        timer = window.setTimeout(poll, 2_000);
      } catch (err) {
        if (alive) {
          setError(err.message || "Quick Connect stopped responding.");
          setBusy(false);
        }
      }
    };
    timer = window.setTimeout(poll, 1_500);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [configuredServer, connectWithQuickConnect, quickRequest, server]);

  const startQuickConnect = async () => {
    const base = configuredServer || server;
    setBusy(true);
    setError(null);
    setQuickRequest(null);
    try {
      if (!(await quickConnectAvailable(base))) throw new Error("Quick Connect is not enabled on this Jellyfin server.");
      setQuickRequest(await initiateQuickConnect(base));
    } catch (err) {
      setError(err.message || "Quick Connect could not be started.");
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect(server, username, password);
      // success flips session state → the app mounts itself
    } catch (err) {
      setError(err.message || "Couldn't connect to that server.");
      setBusy(false);
    }
  };

  const submitApiKey = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const users = await listApiKeyUsers(server, apiKey);
      setProfiles(users);
    } catch (err) {
      setError(err.message || "Couldn't connect to that server.");
    } finally {
      setBusy(false);
    }
  };

  const pickProfile = async (u) => {
    setBusy(true);
    setError(null);
    try {
      await connectWithApiKey(server, apiKey, u);
    } catch (err) {
      setError(err.message || "Couldn't connect to that server.");
      setBusy(false);
    }
  };

  if (profiles) {
    return (
      <div className="connect">
        <div className="connect-card reveal">
          <h1 className="connect-title">Who's this?</h1>
          <p className="connect-sub">Pick which profile this API key should act as.</p>
          <div className="connect-profiles">
            {profiles.map((u) => (
              <button
                key={u.Id}
                type="button"
                className="connect-profile"
                disabled={busy}
                onClick={() => pickProfile(u)}
              >
                <img src={userAvatarUrl(server, apiKey, u)} alt="" aria-hidden />
                <span>{u.Name}</span>
              </button>
            ))}
          </div>
          {error && (
            <div className="connect-err" role="alert">
              {error}
            </div>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => {
              setProfiles(null);
              setError(null);
            }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="connect">
      <form
        className="connect-card reveal"
        onSubmit={mode === "password" ? submitPassword : mode === "apikey" ? submitApiKey : (event) => event.preventDefault()}
      >
        <div className="connect-brand" aria-label="Jellyflow">
          <div className="connect-mark" aria-hidden />
          <span>Jellyflow</span>
        </div>
        <h1 className="connect-title">
          Your library,
          <br />
          re-lit.
        </h1>
        <p className="connect-sub">
          Your own Jellyfin library, with quieter navigation and the artwork brought forward.
          Your files never leave your server.
        </p>

        <div className="connect-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "password"}
            className={mode === "password" ? "active" : ""}
            onClick={() => {
              setMode("password");
              setError(null);
            }}
          >
            Username &amp; password
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "quick"}
            className={mode === "quick" ? "active" : ""}
            onClick={() => {
              setMode("quick");
              setError(null);
              setQuickRequest(null);
            }}
          >
            Quick Connect
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "apikey"}
            className={mode === "apikey" ? "active" : ""}
            onClick={() => {
              setMode("apikey");
              setError(null);
            }}
          >
            API key
          </button>
        </div>

        {configuredServer ? (
          <div className="connect-fixed-server">
            <span>Server</span>
            <strong>{configuredServerName || hostOf(configuredServer)}</strong>
            <small>Configured by this Jellyflow instance</small>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="cf-server">Server address</label>
            <input
              id="cf-server"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="https://jellyfin.example.org"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              required
            />
          </div>
        )}

        {mode === "password" ? (
          <>
            <div className="field">
              <label htmlFor="cf-user">Username</label>
              <input
                id="cf-user"
                type="text"
                autoComplete="username"
                placeholder="e.g. louie"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="cf-pass">Password</label>
              <input
                id="cf-pass"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </>
        ) : mode === "apikey" ? (
          <div className="field">
            <label htmlFor="cf-apikey">API key</label>
            <input
              id="cf-apikey"
              type="password"
              autoComplete="off"
              placeholder="Dashboard → API Keys"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required
            />
          </div>
        ) : (
          <div className="connect-quick" aria-live="polite">
            {quickRequest ? (
              <>
                <span>Enter this code in Jellyfin</span>
                <strong>{quickRequest.Code}</strong>
                <small>Dashboard or profile menu → Quick Connect</small>
                <button className="btn" type="button" onClick={startQuickConnect}>Request a new code</button>
              </>
            ) : (
              <>
                <p>Authorise this browser from any device already signed in to your Jellyfin server.</p>
                <button className="btn" type="button" onClick={startQuickConnect} disabled={busy || !(configuredServer || server)}>
                  {busy ? "Requesting…" : "Get a Quick Connect code"}
                </button>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="connect-err" role="alert">
            {error}
          </div>
        )}

        {mode !== "quick" && (
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
            {busy ? "Connecting…" : mode === "password" ? "Open the doors" : "Continue"}
          </button>
        )}

        <div className="connect-foot">
          <span style={{ color: "var(--ink-dim)" }}>Jellyflow keeps no accounts or database.</span> Your
          sign-in is used only with the selected Jellyfin server, and session data stays in this browser.
        </div>
      </form>
    </div>
  );
}

/** Shown when a saved session no longer authenticates. */
export function SessionLost({ error, onReset }) {
  return (
    <div className="connect">
      <div className="connect-card reveal">
        <h1 className="connect-title">Session ended</h1>
        <p className="connect-sub" style={{ marginBottom: 20 }}>
          {error || "Your session could not be revalidated."}
        </p>
        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={onReset}>
          Sign in again
        </button>
      </div>
    </div>
  );
}
