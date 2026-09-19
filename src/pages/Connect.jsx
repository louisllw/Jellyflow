import { useState } from "react";
import { useSession } from "../state/Session.jsx";
import { userAvatarUrl } from "../api/jellyfin.js";

/**
 * The front door. Anyone running this image lands here and points it at
 * their own Jellyfin server — no build step, no config file.
 */
export function Connect({ prefill, existingError }) {
  const { connect, connectWithApiKey, listApiKeyUsers } = useSession();
  const [mode, setMode] = useState("password"); // "password" | "apikey"
  const [server, setServer] = useState(prefill || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [profiles, setProfiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(existingError || null);

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
        onSubmit={mode === "password" ? submitPassword : submitApiKey}
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
        ) : (
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
        )}

        {error && (
          <div className="connect-err" role="alert">
            {error}
          </div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>
          {busy ? "Connecting…" : mode === "password" ? "Open the doors" : "Continue"}
        </button>

        <div className="connect-foot">
          <span style={{ color: "var(--ink-dim)" }}>Jellyflow is a frontend only.</span> It runs in
          your browser, signs in with your own credentials, and streams straight from your server —
          nothing is relayed or stored here.
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
