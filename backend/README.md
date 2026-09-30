# VIDYASETU backend

Backend for VIDYASETU, the scholarship and fellowship management platform of the
Ministry of Tribal Affairs.

**Phase 0 (this state)** provides only the skeleton and infrastructure: config
validation, structured logging, request IDs, a standard error shape, health checks,
OpenAPI and the local Docker stack. It has no business features yet.

| Service    | Tech                              | Role                                                                     |
| ---------- | --------------------------------- | ------------------------------------------------------------------------ |
| `api`      | NestJS 11, TypeScript (strict), Node 22 | Everything users touch: auth, workflow, rules, uploads, queues, notifications, audit (later phases) |
| `ml`       | FastAPI, Python 3.12              | Internal-only OCR / ML. Only `api` calls it. No internet access.         |
| `postgres` | PostgreSQL 16                     | Primary database (Prisma ORM)                                            |
| `redis`    | Redis 7                           | Cache and queues (later phases)                                          |
| `minio`    | MinIO (S3-compatible)             | Document storage (`documents` bucket)                                    |
| `mailpit`  | Mailpit                           | Local SMTP catcher for development email                                 |

Standing rules: everything runs locally, with no external AI services or runtime
model downloads. Every dependency and image is pinned. Every error uses the standard
shape. Every phase ships with passing tests.

---

## 1. Prerequisites

- Docker Engine 24+ with Docker Compose v2 (`docker compose version`)
- For local tests, lint and OpenAPI: Node.js 22 LTS with npm, Python 3.12
- GNU make (optional). On Windows, use Git Bash with make installed, or run the
  commands behind each target directly (they are listed in the `Makefile`).

## 2. Setup

```bash
cp .env.example .env        # safe local defaults; edit if ports clash
make install                # api: npm ci, ml: .venv + pinned deps (only needed for local test/lint)
```

## 3. Running

```bash
make up        # docker compose up -d --build
make ps        # wait until api and ml show "healthy"
make logs      # or: make logs s=api
make down      # stop; named volumes (postgres-data, minio-data) are kept
```

Startup order is enforced with `depends_on: condition: service_healthy`:
postgres, redis, minio (healthy) -> minio-init (completed) -> ml (healthy) -> api.

| URL (host)                          | What                                          |
| ----------------------------------- | --------------------------------------------- |
| http://127.0.0.1:3000/health/live   | Liveness                                      |
| http://127.0.0.1:3000/health/ready  | Readiness (DB, Redis, MinIO bucket, ml)       |
| http://127.0.0.1:3000/docs          | Swagger UI (`/docs/openapi.json` for the raw spec) |
| http://127.0.0.1:8025               | Mailpit web UI                                |
| http://127.0.0.1:9001               | MinIO console (log in with `MINIO_ROOT_*`)    |

To wipe all local data: `docker compose down -v`. This deletes the volumes.

## 4. Testing, linting, OpenAPI

```bash
make test      # api: jest unit + e2e; ml: pytest
make lint      # api: eslint + prettier --check + tsc; ml: ruff check + ruff format --check
make format    # auto-format both
make openapi   # writes api/openapi.json without starting a server or any dependency
```

The full check list (all must pass before a phase is closed). Without `make`,
run them from `api/`:

| Check | Command (from `api/`) |
|---|---|
| Scheme rule parameters | `npm run validate:rules` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Formatting | `npm run format:check` |
| Unit tests | `npm test` |
| e2e tests (incl. the RBAC matrix) | `npm run test:e2e` |
| ML tests | `npm run test:ml` (same as `make test-ml`) |

`npm run test:ml` builds the production ml image, layers pytest and the tests
on it (`ml/Dockerfile.test`), and runs the suite with `--network none`, so the
tests use exactly the production OCR stack and nothing reaches the network.

The api e2e tests boot the real `AppModule` with every dependency pointed at an
unreachable port. This proves the app starts and serves traffic while all
dependencies are down, and checks that `/health/ready` answers 503. You may see
Jest print "did not exit one second after the test run". That is Prisma's native
engine finishing its reconnect attempt to the unreachable test database, and the
process exits on its own a few seconds later.

## 5. Network design

```
                     host (127.0.0.1 only)
          :3000 api        :8025 mailpit UI     :9001 minio console
             |                  |                      |
  ===========|==================|======================|=======  edge (bridge, has internet)
             |                  |                      |
           [api]            [mailpit]               [minio]
             |                                         |
  ===========|=========================================|=======  backend (internal: true, NO internet)
             |           |           |           |     |
         [postgres]   [redis]      [ml]    [minio-init]
```

- **backend** is `internal: true`. Docker gives it no gateway, so its containers
  cannot reach the internet. Members: postgres, redis, minio, minio-init, ml, api.
- **edge** is a normal bridge. Members: api (the only user-facing entry point) and
  mailpit.
- **ml is attached only to backend**. It has no internet access and no published
  port. Only the api can reach it, at `http://ml:8000`.
- postgres, redis and the MinIO S3 API (9000) are never published to the host.
- **Deviation from the spec, and why:** Docker cannot publish ports of a container
  that sits only on an internal network. So `minio` also joins `edge`, purely so
  its console (9001) can be bound to `127.0.0.1`. The S3 API port stays unpublished.
  If you don't need the console, delete minio's `edge` network and `ports:` entries.
- api and ml containers run as non-root with `read_only: true`, `cap_drop: ALL` and
  `no-new-privileges`.

### MinIO image note

The official `minio/minio` and `minio/mc` images are no longer available on Docker
Hub, and quay.io now requires authentication. The stack therefore uses the
community-maintained `pgsty/minio` and `pgsty/mc` builds, pinned to release tags.
If your organisation mirrors approved images, change the two `image:` lines in
`docker-compose.yml`.

`minio-init` creates the private `documents` bucket. It also creates a
least-privilege account (`MINIO_API_ACCESS_KEY`) that can only read and write that
bucket. The api uses this account, never the root credentials.

## 6. Conventions later phases rely on

**Error shape.** Every non-2xx response from both services has exactly this shape:

```json
{ "code": "NOT_FOUND", "message": "The requested resource was not found.", "details": null, "requestId": "3f2b8c1e-..." }
```

- `code` is an `ErrorCode`: `VALIDATION_ERROR`, `BAD_REQUEST`, `UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `CONFLICT`, `PAYLOAD_TOO_LARGE`,
  `UNSUPPORTED_MEDIA_TYPE`, `TOO_MANY_REQUESTS`, `DEPENDENCY_UNAVAILABLE`,
  `INTERNAL_ERROR`.
- Validation errors return 400 with
  `details: [{ "field": "address.pincode", "constraints": { "minLength": "..." } }]`.
- Unexpected errors return 500 `INTERNAL_ERROR` with a generic message. The full
  error and stack are logged, never returned to the client.
- Messages live in one catalogue (`api/src/common/errors/error-messages.ts` and
  `ml/app/errors.py`), ready for conversion to i18n keys.

**Request IDs.** Clients may send `X-Request-ID`. A safe value (1–128 characters
from `[A-Za-z0-9._:-]`) is reused; otherwise a UUID v4 is generated. The ID is
returned in the `X-Request-ID` response header, appears in every log line as
`requestId`, and is forwarded by the api to ml on every call.

**Config.** Both services validate the environment at startup and exit non-zero,
listing every failing variable by name. Values are never printed. In the api,
only `src/config` reads `process.env`, and ESLint enforces this.

## 7. Layout

```
vidyasetu/
  docker-compose.yml  .env.example  Makefile  README.md
  api/   NestJS service  (src/{config,common,prisma,storage,redis,ml-client,health,openapi}, test/)
  ml/    FastAPI service (app/{main,config,logging,errors,middleware,health}.py, tests/)
```
