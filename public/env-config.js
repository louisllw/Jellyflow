// Safe development default. The Docker image overwrites this at container
// startup when JELLYFIN_URL pins the deployment to a server (see docker-entrypoint.sh).
window.JELLYFIN_SERVER_URL = "";
