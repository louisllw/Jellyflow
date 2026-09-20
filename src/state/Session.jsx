import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  Jellyfin,
  clearConfig,
  listUsersWithApiKey,
  loadConfig,
  login,
  loginWithQuickConnect,
  normalizeServerUrl,
  runtimeServerName,
  runtimeServerUrl,
  saveConfig,
  saveLastServer,
} from "../api/jellyfin.js";
import { retireClient } from "./sessionLifecycle.js";

const Ctx = createContext(null);

export function SessionProvider({ children }) {
  const [configuredServer] = useState(() => runtimeServerUrl());
  const [configuredServerName] = useState(() => runtimeServerName());
  const [cfg, setCfg] = useState(() => {
    const saved = loadConfig();
    if (configuredServer && normalizeServerUrl(saved?.serverUrl) !== configuredServer) return null;
    return saved;
  });
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(Boolean(cfg));
  const [authError, setAuthError] = useState(null);
  const clientRef = useRef(null);

  const ready = Boolean(cfg && !booting);

  const expireSession = useCallback((expiredClient) => {
    // Ignore a late failure from a client that has already been replaced.
    if (clientRef.current !== expiredClient) return;
    expiredClient.disconnectSocket();
    clearConfig();
    clientRef.current = null;
    setCfg(null);
    setUser(null);
    setBooting(false);
    setAuthError("Your session expired — sign in again.");
  }, []);

  const installClient = useCallback((newCfg) => {
    const previous = clientRef.current;
    if (previous) {
      const sameCredential = previous.serverUrl === newCfg.serverUrl && previous.token === newCfg.token;
      retireClient(previous, { revoke: !sameCredential });
    }
    const next = new Jellyfin(newCfg);
    next.onSessionExpired = () => expireSession(next);
    clientRef.current = next;
    next.registerCapabilities();
    next.connectSocket();
    return next;
  }, [expireSession]);

  const connect = useCallback(async (serverUrl, username, password) => {
    const base = configuredServer || normalizeServerUrl(serverUrl);
    const { user: u, token } = await login(base, username.trim(), password);
    const newCfg = {
      serverUrl: base,
      serverName: configuredServerName || undefined,
      username: u.Username,
      userId: u.Id,
      token,
      name: u.Name,
    };
    saveConfig(newCfg);
    saveLastServer(base);
    installClient(newCfg);
    setCfg(newCfg);
    setUser(u);
    setAuthError(null);
    return u;
  }, [configuredServer, configuredServerName, installClient]);

  const connectWithQuickConnect = useCallback(async (serverUrl, secret) => {
    const base = configuredServer || normalizeServerUrl(serverUrl);
    const { user: u, token } = await loginWithQuickConnect(base, secret);
    const newCfg = {
      serverUrl: base,
      serverName: configuredServerName || undefined,
      username: u.Username,
      userId: u.Id,
      token,
      name: u.Name,
    };
    saveConfig(newCfg);
    saveLastServer(base);
    installClient(newCfg);
    setCfg(newCfg);
    setUser(u);
    setAuthError(null);
    return u;
  }, [configuredServer, configuredServerName, installClient]);

  // Step 1 of API-key sign-in: validate the key and hand back the server's
  // user list so the UI can ask which profile to act as.
  const listApiKeyUsers = useCallback(async (serverUrl, apiKey) => {
    const base = configuredServer || normalizeServerUrl(serverUrl);
    return listUsersWithApiKey(base, apiKey.trim());
  }, [configuredServer]);

  // Step 2: finish connecting once a profile has been picked.
  const connectWithApiKey = useCallback(async (serverUrl, apiKey, user) => {
    const base = configuredServer || normalizeServerUrl(serverUrl);
    const newCfg = {
      serverUrl: base,
      serverName: configuredServerName || undefined,
      username: user.Name,
      userId: user.Id,
      token: apiKey.trim(),
      name: user.Name,
      isApiKey: true,
    };
    saveConfig(newCfg);
    saveLastServer(base);
    installClient(newCfg);
    setCfg(newCfg);
    setUser(user);
    setAuthError(null);
    return user;
  }, [configuredServer, configuredServerName, installClient]);

  const disconnect = useCallback(() => {
    const current = clientRef.current;
    clientRef.current = null;
    retireClient(current, { revoke: true });
    clearConfig();
    setCfg(null);
    setUser(null);
    setBooting(false);
    setAuthError(null);
  }, []);

  // Revalidate a stored session on load.
  useEffect(() => {
    if (!cfg) {
      setBooting(false);
      return;
    }
    let alive = true;
    const bootClient = new Jellyfin(cfg);
    bootClient.onSessionExpired = () => expireSession(bootClient);
    clientRef.current = bootClient;
    (async () => {
      try {
        const u = await bootClient.me();
        if (!alive) return;
        setUser(u);
        bootClient.registerCapabilities();
        bootClient.connectSocket();
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
      bootClient.disconnectSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expireSession]);

  const client = clientRef.current;

  useEffect(() => {
    if (!client) return undefined;
    return client.onSocketMessage((message) => {
      if (message?.MessageType !== "SyncPlayGroupUpdate" || message.Data?.Type !== "PlayQueue") return;
      const first = message.Data?.Data?.Playlist?.[0];
      if (!first?.ItemId || window.location.hash.includes(`/item/${first.ItemId}`)) return;
      window.location.hash = `#/item/${encodeURIComponent(first.ItemId)}?play=1&sync=1`;
    });
  }, [client]);

  const value = useMemo(
    () => ({
      cfg,
      user,
      client,
      ready,
      booting,
      authError,
      configuredServer,
      configuredServerName,
      connect,
      connectWithQuickConnect,
      connectWithApiKey,
      listApiKeyUsers,
      disconnect,
    }),
    [cfg, user, ready, booting, authError, configuredServer, configuredServerName, connect, connectWithApiKey, connectWithQuickConnect, listApiKeyUsers, disconnect],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside <SessionProvider>");
  return v;
}
