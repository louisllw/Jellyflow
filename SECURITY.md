# Security

Please report suspected vulnerabilities privately through GitHub's security
advisory form instead of opening a public issue.

Jellyflow is a browser client. Credentials are sent directly to the Jellyfin
server selected by the user; passwords are not retained, but the resulting
session token is stored in the browser's local storage until sign-out.

Do not put credentials, API keys, or private server addresses in `.env.example`,
`public/env-config.js`, screenshots, issues, or commits. Use an untracked `.env`
file or deployment secret for `JELLYFIN_URL`.
