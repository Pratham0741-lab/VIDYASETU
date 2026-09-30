# VIDYASETU api: multi-stage build, runs as the unprivileged `node` user.

ARG NODE_IMAGE=node:22.23.3-bookworm-slim

# ---- deps: full install (incl. dev deps) + Prisma client generation ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Prisma's query engine needs OpenSSL.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate` (engines are fetched at build time only).
RUN npm ci --no-audit --no-fund

# ---- build: compile TypeScript, then drop dev dependencies --------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# The canonical scheme-config JSON Schema: the scheme-authoring API validates
# drafts against it at runtime (it was seed-only before).
COPY schemas ./schemas
RUN npm run build \
 && npm prune --omit=dev --no-audit --no-fund

# ---- security: dependency audit + licence inventory (Phase 17, F3) ----------
# Runs at build time on the production tree left by `npm prune`. `npm audit`
# needs the registry: if it cannot be reached the report says NOT RUN (the
# build does not fail and nothing is invented). The licence inventory is
# offline. The reports are copied into the runtime image under /app/security.
FROM build AS security
COPY security ./security
RUN node security/npm-audit.mjs security-report  && node security/licences.mjs security-report

# ---- migrate: one-shot DB tooling (compose service `db-migrate`) -------------
# Full dev toolchain from `deps` (prisma CLI, tsx, ajv) plus the files that
# migrate/seed/scripts read. Runs on the internal network only, so Prisma's
# update/telemetry checks are disabled.
FROM deps AS migrate
COPY tsconfig.json ./
COPY schemas ./schemas
COPY scripts ./scripts
COPY src ./src
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/set-app-user-password.ts && npx prisma db seed && npx tsx scripts/seed-roles.ts"]

# ---- fonts: Devanagari for PDFs (Phase 17, F4) --------------------------------
# Lohit Devanagari (SIL Open Font License 1.1) from the Debian archive, at
# build time: PDF text containing Devanagari is drawn with it (common/pdf/
# fonts.ts). It also covers printable ASCII, so mixed Hindi / English text in
# one string renders. Only the font file and its licence reach the runtime image.
FROM ${NODE_IMAGE} AS fonts
RUN apt-get update  && apt-get install -y --no-install-recommends fonts-lohit-deva  && mkdir -p /fonts  && cp /usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf /fonts/  && cp /usr/share/doc/fonts-lohit-deva/copyright /fonts/LICENSE-Lohit-Devanagari.txt  && rm -rf /var/lib/apt/lists/*

# ---- runtime -----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
# Files stay root-owned and read-only for the runtime user.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/schemas ./schemas
COPY --from=security /app/security-report ./security
COPY --from=fonts /fonts ./fonts
# Migrations and seeding run in the separate `migrate` stage (db-migrate service).
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
