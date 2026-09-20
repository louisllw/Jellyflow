import { useEffect, useState } from "react";
import { useSession } from "../state/Session.jsx";
import { hostOf } from "../api/jellyfin.js";

/**
 * Settings — the only place the app talks about itself.
 *
 * Who you're signed in as, which server you're pointed at, and the escape
 * hatches: switch server when the deployment allows it, or sign out cleanly.
 */
export function Settings() {
  const { cfg, user, client, disconnect, connect, configuredServer } = useSession();
  const [showForm, setShowForm] = useState(false);
  const [server, setServer] = useState(cfg?.serverUrl || "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [joinedGroup, setJoinedGroup] = useState(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [endpointInfo, setEndpointInfo] = useState(null);

  const loadGroups = async () => {
    try {
      const result = await client.syncPlayGroups();
      setGroups(Array.isArray(result) ? result : result?.Items || []);
    } catch {
      setGroups([]);
    }
  };

  useEffect(() => {
    loadGroups();
    client.endpointInfo().then(setEndpointInfo).catch(() => {});
    const timer = window.setInterval(loadGroups, 15_000);
    const unsubscribe = client.onSocketMessage((message) => {
      if (message?.MessageType !== "SyncPlayGroupUpdate") return;
      if (["GroupJoined", "GroupUpdate"].includes(message.Data?.Type)) setJoinedGroup(message.Data?.Data || null);
      if (["GroupLeft", "NotInGroup"].includes(message.Data?.Type)) setJoinedGroup(null);
      loadGroups();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const createGroup = async (event) => {
    event.preventDefault();
    if (!groupName.trim()) return;
    setSyncBusy(true);
    try {
      await client.createSyncPlayGroup(groupName.trim());
      setJoinedGroup({ GroupName: groupName.trim() });
      setGroupName("");
      await loadGroups();
    } catch (err) {
      setError(err.message || "The watch-together room could not be created.");
    } finally {
      setSyncBusy(false);
    }
  };

  const joinGroup = async (group) => {
    setSyncBusy(true);
    try {
      await client.joinSyncPlayGroup(group.GroupId);
      setJoinedGroup(group);
    } catch (err) {
      setError(err.message || "That room could not be joined.");
    } finally {
      setSyncBusy(false);
    }
  };

  const leaveGroup = async () => {
    setSyncBusy(true);
    try {
      await client.leaveSyncPlayGroup();
      setJoinedGroup(null);
      await loadGroups();
    } finally {
      setSyncBusy(false);
    }
  };

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
            <dd>{cfg?.serverName || hostOf(cfg?.serverUrl)}</dd>
          </div>
          {endpointInfo && (
            <div className="spec-row">
              <dt>Connection</dt>
              <dd>{endpointInfo.IsLocal || endpointInfo.IsInNetwork ? "Local network" : "Remote"}</dd>
            </div>
          )}
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
          Your session is stored only in this browser (localStorage). Sign-in details are used only with the
          configured Jellyfin server, through this deployment's local proxy when enabled. Sign out to erase the session.
        </p>
      </div>

      <section className="settings-panel settings-syncplay reveal">
        <div className="settings-eyebrow">SyncPlay</div>
        <h2 className="settings-title">Watch together</h2>
        <p className="settings-sub">Create or join a room hosted by your Jellyfin server.</p>
        {joinedGroup ? (
          <div className="syncplay-current">
            <span>Joined room</span>
            <strong>{joinedGroup.GroupName || "Watch together"}</strong>
            <button className="btn" onClick={leaveGroup} disabled={syncBusy}>Leave room</button>
          </div>
        ) : (
          <>
            <form className="syncplay-create" onSubmit={createGroup}>
              <div className="field">
                <label htmlFor="syncplay-name">New room name</label>
                <input id="syncplay-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={200} />
              </div>
              <button className="btn btn-primary" disabled={syncBusy || !groupName.trim()}>Create room</button>
            </form>
            <div className="syncplay-groups">
              {groups.length ? groups.map((group) => (
                <button key={group.GroupId} onClick={() => joinGroup(group)} disabled={syncBusy}>
                  <span>{group.GroupName || "Watch together"}</span>
                  <small>{group.Participants?.length || 0} connected</small>
                </button>
              )) : <p>No open rooms on this server.</p>}
            </div>
          </>
        )}
      </section>
    </>
  );
}
