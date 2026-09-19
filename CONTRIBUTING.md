# Contributing to Jellyflow

Thanks for helping improve Jellyflow. Bug reports, design feedback, testing and focused pull requests are all welcome.

## Before opening an issue

- Search the existing issues first.
- Remove server addresses, access tokens, usernames and private library details from screenshots and logs.
- For playback problems, include the browser, operating system, Jellyfin version and a sanitised description of the media codecs.
- Security vulnerabilities should be reported privately as described in [SECURITY.md](SECURITY.md).

## Local development

Jellyflow needs Node.js 22 and npm.

```sh
npm ci
npm run dev
```

Run the checks before submitting a pull request:

```sh
npm audit --audit-level=high
npm run build
docker build -t jellyflow:test .
```

Test against a Jellyfin server you are authorised to use. Do not commit `.env` files, credentials, tokens, private media, or identifying screenshots.

## Pull requests

- Keep each pull request focused and explain the user-facing change.
- Describe how the change was tested, including mobile testing where relevant.
- Preserve accessibility, keyboard control, reduced-motion support and responsive layouts.
- Update documentation when behaviour or configuration changes.
- You remain responsible for submitted code. Disclose substantial AI-assisted changes so reviewers can apply the right level of scrutiny.

By contributing, you agree that your contribution is licensed under the MIT License.
