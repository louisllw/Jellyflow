import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  Jellyfin,
  clearConfig,
  listUsersWithApiKey,
  loadConfig,
  login,
  normalizeServerUrl,
  saveConfig,
  saveLastServer,
} from "../api/jellyfin.js";

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [cfg, setCfg] = useState(() => loadConfig());
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(cfg));
  const [authError, setAuthError] = useState(null);
  const clientRef = useRef(null);

  const ready = Boolean(cfg && !booting);

  const connect = useCallback(async (serverUrl, username, password) => {
    const base = normalizeServerUrl(serverUrl);
    const { user: u, token } = await login(base, username.trim(), password);
    const newCfg = {
      serverUrl: base,
      username: u.Username,
      userId: u.Id,
      token,
      name: u.Name,
    };
    saveConfig(newCfg);
    saveLastServer(base);
    clientRef.current = new Jellyfin(newCfg);
    setCfg(newCfg);
    setUser(u);
    setAuthError(null);
    return u;
  }, []);

  // Step 1 of API-key sign-in: validate the key and hand back the server's
  // user list so the UI can ask which profile to act as.
  const listApiKeyUsers = useCallback(async (serverUrl, apiKey) => {
    const base = normalizeServerUrl(serverUrl);
    return listUsersWithApiKey(base, apiKey.trim());
  }, []);

  // Step 2: finish connecting once a profile has been picked.
  const connectWithApiKey = useCallback(async (serverUrl, apiKey, user) => {
    const base = normalizeServerUrl(serverUrl);
    const newCfg = {
      serverUrl: base,
      username: user.Name,
      userId: user.Id,
      token: apiKey.trim(),
      name: user.Name,
      isApiKey: true,
    };
    saveConfig(newCfg);
    saveLastServer(base);
    clientRef.current = new Jellyfin(newCfg);
    setCfg(newCfg);
    setUser(user);
    setAuthError(null);
    return user;
  }, []);

  const disconnect = useCallback(() => {
    clearConfig();
    clientRef.current = null;
    setCfg(null);
    setUser(null);
    setBooting(false);
  }, []);

  // Revalidate a stored session on load.
  useEffect(() => {
    if (!cfg) {
      setBooting(false);
      return;
    }
    let alive = true;
    clientRef.current = new Jellyfin(cfg);
    (async () => {
      try {
        const u = await clientRef.current.me();
        if (!alive) return;
        setUser(u);
        // Replace, don't mutate: cfg lives in state, and mutating it in place
        // would skip re-renders for anything keyed on the object's identity.
        if (u && u.Policy) setCfg((c) => (c ? { ...c, Policy: u.Policy } : c));
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          clearConfig();
          setCfg(null);
          clientRef.current = null;
        } else {
          setAuthError(e.message || "Session could not be revalidated.");
        }
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const client = clientRef.current;

  const value = useMemo(
    () => ({
      cfg,
      user,
      client,
      ready,
      booting,
      authError,
      connect,
      connectWithApiKey,
      listApiKeyUsers,
      disconnect,
    }),
    [cfg, user, ready, booting, authError, connect, connectWithApiKey, listApiKeyUsers, disconnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside <SessionProvider>");
  return v;
}
