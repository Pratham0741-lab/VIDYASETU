# Translation notes (officer portal)

## Status

- **English** (`src/i18n/en.ts`) is the source text.
- **Hindi** (`src/i18n/hi.ts`) is **machine-drafted and unreviewed**. It
  must be reviewed by a fluent Hindi speaker before any real use.
- Every key of `en.ts` exists in `hi.ts`; `pnpm typecheck` fails otherwise
  (`hi` is typed `Record<MessageKey, string>`).

## What is translated where

| Text | Source | Hindi status |
|---|---|---|
| Portal UI (labels, buttons, headings, help text) | `src/i18n/en.ts`, `hi.ts` | machine-drafted, unreviewed |
| Error text for backend `code`, `details.reason`, `details.message_key` | `src/i18n/*` (`code.*`, `reason.*`, `api.*`) | machine-drafted, unreviewed |
| Role, stage, flag type, list status labels | `src/i18n/*` | machine-drafted, unreviewed |
| Deficiency problem codes (`deficiency.problem.*`) | labels in `src/i18n/*` (backend texts are applicant-facing) | machine-drafted, unreviewed |
| Backend free text: fraud flag `summary`, audit `vouches_for` / `cannot_vouch_for`, chain break `detail`, analytics `meta` notes | backend, English only | **not translated** (shown as returned) |
| Unknown backend error messages | raw backend `message` (English) | fallback only |

## Known gaps

- The bundled fonts (DM Sans, Nunito, ...) have no Devanagari; Hindi uses
  the operating system's Devanagari font.
- Numbers and dates use `hi-IN` / `en-IN` formatting from the browser.
- The officer's language is saved with `PUT /officers/me/preferences`
  (not for AUDITOR, which the backend keeps read-only).
