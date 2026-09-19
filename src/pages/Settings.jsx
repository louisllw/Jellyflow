import { useState } from "react";
import { useSession } from "../state/Session.jsx";
import { hostOf } from "../api/jellyfin.js";

/**
 * Settings — the only place the app talks about itself.
 *
 * Who you're signed in as, which server you're pointed at, and the escape
 * hatches: switch server when the deployment allows it, or sign out cleanly.
 */
export function Settings() {
  const { cfg, user, disconnect, connect, configuredServer } = useSession();
  const [showForm, setShowForm] = useState(false);
  const [server, setServer] = useState(cfg?.serverUrl || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // connect() swaps the session client in place through the provider, so
      // the switch takes effect immediately — no hard reload, no lost state.
      await connect(server, username, password);
      window.location.hash = "#/";
    } catch (err) {
      setError(err.message || "Couldn't connect to that server.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="settings-panel reveal">
        <div className="settings-eyebrow">Jellyfin server</div>
        <h1 className="settings-title">Your connection</h1>
        <p className="settings-sub">Manage the server and profile this browser uses.</p>
        <dl className="spec settings-spec">
          <div className="spec-row">
            <dt>Signed in as</dt>
            <dd>{user?.Name}</dd>
          </div>
          <div className="spec-row">
            <dt>Username</dt>
            <dd>{user?.Username}</dd>
          </div>
          <div className="spec-row">
            <dt>Server</dt>
            <dd>{hostOf(cfg?.serverUrl)}</dd>
          </div>
        </dl>

        {configuredServer && <p className="settings-fixed-server">Fixed by this Jellyflow deployment.</p>}

        {!configuredServer && showForm && (
          <form onSubmit={submit} className="settings-form">
            <div className="field">
              <label>Server address</label>
              <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://…" required />
            </div>
            <div className="field">
              <label>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && (
              <div className="connect-err" role="alert">
                {error}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Connecting…" : "Connect"}
              </button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="settings-actions">
          {!configuredServer && (
            <button className="btn" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Close form" : "Connect to a different server"}
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              if (window.confirm("Sign out of Jellyflow on this device? Your session here will be cleared.")) {
                disconnect();
              }
            }}
          >
            Sign out
          </button>
        </div>

        <p className="settings-privacy">
          Your credentials are stored only in this browser (localStorage) and are never sent anywhere except the
          configured Jellyfin server. Sign out to erase them.
        </p>
      </div>
    </>
  );
}
