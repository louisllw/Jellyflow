# Security

Please report suspected vulnerabilities privately through GitHub's security
advisory form instead of opening a public issue.

Jellyflow is a browser client with an optional same-origin proxy. When
`JELLYFIN_URL` is set, the local Jellyflow nginx process forwards credentials
and media to that fixed server; otherwise the browser connects directly to the
server selected by the user. Passwords are not retained, but the resulting
session token is stored in the browser's local storage until sign-out. Proxy
access logging is disabled so tokens carried in media URLs are not written to
the container log.

Do not put credentials, API keys, or private server addresses in `.env.example`,
`public/env-config.js`, screenshots, issues, or commits. Use an untracked `.env`
file or deployment secret for `JELLYFIN_URL`.
