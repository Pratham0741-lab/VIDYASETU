# VIDYASETU (prototype)

A prototype scholarship and fellowship management platform built for the Smart India Hackathon 2026. It is not an official government portal.

## Folders
- backend/ - NestJS API, FastAPI ML service, Postgres, Redis, MinIO (Docker). See backend/README.md.
- frontend/STUDENT - applicant portal (React + Vite, port 5173).
- frontend/ADMIN - officer portal (React + Vite, port 5174).

## Run
1. Backend: cd backend, copy .env.example to .env, then docker compose up -d. API at http://localhost:3000 (Swagger at /docs).
2. Demo data: see backend/docs/DEMO.md. Demo credentials are kept outside the repository.
3. Frontends: cd frontend/STUDENT (or frontend/ADMIN), pnpm install, pnpm dev.

## Tests
See backend/README.md (typecheck, lint, unit, e2e, ML). In each frontend: pnpm typecheck and pnpm build.

## Limits
See backend/docs/KNOWN_LIMITATIONS.md. Deliberately not in this repository: real scanned documents, local credentials, database dumps.