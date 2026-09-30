# VIDYASETU: instructions for coding agents

Layout (one git repo at this folder, branch main):
- backend/           NestJS api, FastAPI ml, Postgres/Redis/MinIO in Docker
- frontend/STUDENT   applicant portal, port 5173
- frontend/ADMIN     officer portal, port 5174

Git rules
- Work on a feature branch. Never push, add remotes or force.
- Stage only files inside your own folder, by name: git add backend/... or git add frontend/STUDENT/...
- NEVER run git add -A or git add . at the repo root.
- Backend is read only for frontend work, and the other way round.
- Never open the .demo-seed folder (local passwords and database dumps; not in git).

Other rules
- Everything runs offline. No real personal data. No secrets in git.
- Before committing: backend, see backend/README.md checks; frontend, pnpm typecheck and pnpm build.