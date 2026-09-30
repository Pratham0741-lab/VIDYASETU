# VIDYASETU admin portal (prototype): instructions for coding agents

This is the officer-facing portal (scrutiny, fraud, selection, audit,
scheme studio). It began as a static Figma Make design and is being
wired to the real backend API.

- Run: `pnpm dev` (port 5174). Never assume a server is already running.
- Before every commit: `pnpm typecheck` and `pnpm build`.
- This app: D:\PROJECTS\vidyasetu\frontend\ADMIN (own git repo).
- Read only: D:\PROJECTS\vidyasetu\backend (API at VITE_API_BASE_URL,
  default http://localhost:3000/api/v1) and
  D:\PROJECTS\vidyasetu\frontend\STUDENT (source of the shared
  foundation: API client, auth, router, i18n).
- Never open D:\PROJECTS\vidyasetu\.demo-seed.
- Git: run git only inside this folder. Never in a parent folder. Never
  push, add remotes or force. Never `git add` anything outside this app.
- Design: keep the existing markup and CSS. Change data and logic only.
- Offline: no CDN, remote fonts, remote images or analytics.
- Never log tokens, personal data or document contents. Access token in
  memory; refresh token in sessionStorage only; never in URLs.
- User-facing text comes from src/i18n (English and Hindi, Hindi is
  machine-drafted and unreviewed).
- Never show invented numbers as live data. No endpoint means remove it
  from navigation or label it "sample data".
- Types are generated from the OpenAPI file, not hand-written.
- Needed backend change? Write it to docs/BACKEND_REQUESTS.md. Do not
  edit the backend.
- If anything is not as described, stop and report instead of adapting.


## Monorepo update (overrides the Git and "own git repo" lines above)
The project is now one git repo at D:\PROJECTS\vidyasetu (branch main). Run git at that root, stage only files under this app's folder by name, never use git add -A or git add . at the root, and never push, add remotes or force. See the root AGENTS.md.