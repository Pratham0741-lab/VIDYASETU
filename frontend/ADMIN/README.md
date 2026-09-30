# VIDYASETU Admin app

React 19 + Vite 8 + Tailwind CSS v4, from a Figma Make export.
The original export is tagged `design-baseline`.

## Run

```bash
cp .env.example .env    # first time only
pnpm install --frozen-lockfile
pnpm dev                # http://localhost:5174
```

`pnpm build` writes to `dist/`; `pnpm preview` serves it on the same port.

## Port

Dev and preview both default to **5174** with `strictPort` on, so Vite
exits instead of switching ports if 5174 is busy. The `PORT` environment
variable overrides it.

## Environment

| Variable | Example | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:3000/api/v1` | Base URL of the VIDYASETU API |

`.env` is git-ignored; `.env.example` is committed. The API must list
`http://localhost:5174` in its `CORS_ORIGINS`.
