/**
 * Stop a client that is being signed out or replaced. User login and Quick
 * Connect tokens belong to this browser session and can be revoked through
 * Jellyfin. Administrator-created API keys are shared credentials, so signing
 * out of Jellyflow must only forget them locally.
 */
export function retireClient(client, { revoke = false } = {}) {
  if (!client) return Promise.resolve();
  client.onSessionExpired = null;
  client.disconnectSocket();
  if (!revoke || client.cfg?.isApiKey) return Promise.resolve();
  return client.logout().catch(() => {});
}
