# UI v2 notes (student portal)

Design source: `docs/ui-v2/*.png` (six screens). Everything in the images is
sample content; values on screen come from the API or `src/i18n`.

## Colour tokens

Sampled with `python scripts/sample-colours.py` (PIL; mode colour of a small
box, or the darkest pixel for text). Defined once in `src/tokens.css`.

| Role | Sampled | Token |
|---|---|---|
| Page background | #f0f6fb | `--c-page` |
| Navy (step bar, footer, headings) | #32446b | `--c-navy` |
| Primary blue (buttons, header rule, card accent bar, eyebrow) | #316ab1 | `--c-primary` |
| Amber (current-step underline, warning accent bar) | #f4a235 | `--c-amber`, `--c-warning` |
| Success green (result banner) | #297c51 | `--c-success` |
| Success green (completed step card) | #38884c | `--c-success-step` |
| Error red (badge, deadline text) | #dd3c42 | `--c-error` |
| Error tint (alert background) | #fef0f1 | `--c-error-tint` |
| Card border | #d3e4f2 | `--c-border` |
| Card surface | #ffffff | `--c-surface` |
| Muted text | #618098 | `--c-muted` (see contrast) |

Derived tokens (tints, darker text shades of the same hues) are listed in
`src/tokens.css`. The image's warning orange text (#f4a235) and success
text (#23a977) are too light for text on white, so text uses
`--c-warning-text` and `--c-success`.

## Type scale (tokens in `src/tokens.css`)

| Token | Size | Use |
|---|---|---|
| `--fs-caption` | 0.8125rem (13px) | non-essential hints only (`.hint`) |
| `--fs-sm` | 0.875rem (14px) | secondary text, chips, labels |
| `--fs-body` | 1rem (16px) | body, buttons, inputs |
| `--fs-title` | 1.125rem | card title |
| `--fs-title-lg` | 1.25rem | large card title |
| `--fs-section` | 1.5rem | section heading |
| `--fs-h1` | clamp(1.75rem, 1.4rem + 1.2vw, 2.5rem), weight 800 | page H1 |
| `--fs-display` | clamp(2.25rem, 1.8rem + 1.8vw, 3rem) | rank, score, big numbers |

Line height 1.6 body, 1.25 headings; measure 70ch. Hindi (`:root:lang(hi)`):
every size +1px, line height 1.75 (headings 1.4), Noto Sans Devanagari first.
Fonts: Nunito (headings, large numbers), Noto Sans (body, labels, buttons,
tables), from @fontsource only, weights 400/600/700/800, latin and
devanagari subsets, font-display swap. DM Sans, Molengo and Newsreader were
removed. Amounts use `formatAmount` (Intl, INR); dates and numbers use
en-IN / hi-IN; `.num` and `time` are tabular.

Old sizes were mapped to the nearest token at or above them (never smaller):
<=14px -> sm, 15-16 -> body, 17-18 -> title, 19-20 -> title-lg,
21-24 -> section, 25-40 -> h1, >40 -> display.

## Type audit (`node scripts/type-audit.mjs`)

Before (main at the start of UI v2), summary:

```
Font sizes in src: 170 declarations

| size | count |
|---|---|
| 5px | 1 |
| 8px | 12 |
| 9px | 17 |
| 10px | 22 |
| 11px | 30 |
| 12px | 26 |
| 13px | 7 |
| 14px | 5 |
| 15px | 7 |
| 16px | 4 |
| 17px | 6 |
| 18px | 6 |
| 19px | 2 |
| 20px | 8 |
| 21px | 1 |
| 22px | 4 |
| 24px | 3 |
| 30px | 2 |
| 40px | 2 |
| 42px | 2 |
| 44px | 1 |
| 54px | 1 |
| 67px | 1 |

Below 13px: 108
(108 declarations below 13px, 115 below 14px; smallest 5px)
```

After Part A:

```
Font sizes in src: 130 declarations

| size | count |
|---|---|
| 13px | 1 |
| 14px | 88 |
| 16px | 10 |
| 18px | 10 |
| 20px | 7 |
| 24px | 9 |
| 28px | 1 |
| 36px | 4 |

Below 13px: 0
Below 14px (essential, not a caption token): 0
Caption (13px, non-essential hints): 1
  src/base.css: .hint
```

## Contrast (`node scripts/contrast-check.mjs`)

Sampled muted text (#618098) failed 4.5:1 on white (4.16) and the page (3.82); it was darkened to #516a7e (same hue). The completed-step green was darkened from #38884c to #37854a, and the form border from #7f9bb4 to #7791a8.

| foreground | background | ratio | needs | result | use |
|---|---|---|---|---|---|
| --c-ink #32446b | --c-surface #ffffff | 9.66 | 4.5 | pass | text |
| --c-ink #32446b | --c-page #f0f6fb | 8.87 | 4.5 | pass | text |
| --c-ink #32446b | --c-subtle #f6f9fc | 9.14 | 4.5 | pass | text |
| --c-ink #32446b | --c-primary-tint #e4eef8 | 8.22 | 4.5 | pass | text |
| --c-muted #516a7e | --c-surface #ffffff | 5.66 | 4.5 | pass | text |
| --c-muted #516a7e | --c-page #f0f6fb | 5.19 | 4.5 | pass | text |
| --c-muted #516a7e | --c-subtle #f6f9fc | 5.35 | 4.5 | pass | text |
| --c-muted #516a7e | --c-primary-tint #e4eef8 | 4.82 | 4.5 | pass | text |
| --c-primary #316ab1 | --c-surface #ffffff | 5.49 | 4.5 | pass | text |
| --c-primary #316ab1 | --c-page #f0f6fb | 5.04 | 4.5 | pass | text |
| --c-primary #316ab1 | --c-subtle #f6f9fc | 5.19 | 4.5 | pass | text |
| --c-primary #316ab1 | --c-primary-tint #e4eef8 | 4.67 | 4.5 | pass | text |
| --c-muted #516a7e | --c-track #dbe7f3 | 4.51 | 4.5 | pass | text (disabled button) |
| --c-success #297c51 | --c-surface #ffffff | 5.13 | 4.5 | pass | text |
| --c-success #297c51 | --c-success-tint #ebf5ef | 4.60 | 4.5 | pass | text (chip, alert) |
| --c-warning-text #93540a | --c-surface #ffffff | 5.98 | 4.5 | pass | text |
| --c-warning-text #93540a | --c-warning-tint #fdf1e1 | 5.36 | 4.5 | pass | text (chip, alert) |
| --c-error-text #c42d34 | --c-surface #ffffff | 5.57 | 4.5 | pass | text |
| --c-error-text #c42d34 | --c-error-tint #fef0f1 | 5.02 | 4.5 | pass | text (chip, alert) |
| --c-primary #316ab1 | --c-primary-tint #e4eef8 | 4.67 | 4.5 | pass | text (chip) |
| --c-on-navy #ffffff | --c-navy #32446b | 9.66 | 4.5 | pass | text (header bar, footer, buttons) |
| --c-on-navy-muted #c9d3e4 | --c-navy #32446b | 6.40 | 4.5 | pass | text (step bar, footer) |
| --c-on-navy #ffffff | --c-primary #316ab1 | 5.49 | 4.5 | pass | text (blue button) |
| --c-on-navy #ffffff | --c-primary-hover #28599a | 7.03 | 4.5 | pass | text (blue button hover) |
| --c-on-navy #ffffff | --c-success #297c51 | 5.13 | 4.5 | pass | text (selected banner) |
| --c-on-navy #ffffff | --c-success-step #37854a | 4.55 | 4.5 | pass | text (completed step) |
| --c-on-navy #ffffff | --c-error-text #c42d34 | 5.57 | 4.5 | pass | text (badge) |
| --c-amber #f4a235 | --c-navy #32446b | 4.63 | 3 | pass | UI (current-step underline) |
| --c-border-strong #7791a8 | --c-surface #ffffff | 3.28 | 3 | pass | UI (form borders) |
| --c-focus #316ab1 | --c-surface #ffffff | 5.49 | 3 | pass | UI (focus ring) |
| --c-focus #316ab1 | --c-page #f0f6fb | 5.04 | 3 | pass | UI (focus ring) |


## Type audit, final (after Part H)

```
Font sizes in src: 67 declarations

| size | count |
|---|---|
| 13px | 1 |
| 14px | 40 |
| 16px | 6 |
| 18px | 5 |
| 20px | 10 |
| 24px | 2 |
| 28px | 1 |
| 36px | 2 |

Below 13px: 0
Below 14px (essential, not a caption token): 0
Caption (13px, non-essential hints): 1
  src/base.css: .hint
```

Contrast, final: `node scripts/contrast-check.mjs` reports 0 failing pairs and 0 hard-coded colours outside `src/tokens.css`.

## Layout rules

- 8px spacing scale (`--sp-*`), container 1200px with 16px / 24px gutters,
  one card padding (`--card-pad`) and radius (`--radius`) everywhere.
- Cards: white, light-blue border, 4px accent bar on the left (blue by
  default; `accent-green`, `accent-amber`, `accent-red`, `accent-none`).
- Buttons are pills, at least 44px tall, with a 3px focus ring and a flat
  disabled state. Chips (`Tag`) are pills.
- Icons: lucide-react through `Icon` (one stroke width, 20 or 24px).
- Label/value pairs use `dl.kv` (two-column grid, stacks below 400px).
- Header: language switch, notification bell (unread from
  GET /notifications, hidden at zero) and log in/out are visible at every
  width. The step bar scrolls sideways below 768px with the current step
  centred; `aria-current="step"` on it.

## Differences from the images, and why

| Image | Here | Why |
|---|---|---|
| Current step in red (Apply) | Navy with the amber underline; done steps green with a check | Red means error (brief, deviation 1) |
| Apply order: personal, academic, uploads, final review | Profile, scheme details, final review and submit, upload documents | Backend creates the application at submit; uploads need it (deviation 2) |
| Green banner for every result | Green only for SELECTED on a final list; navy for not selected (F1-C); blue otherwise | Deviation 3 |
| 7 steps (Verify, Post-award) | 5 steps | Verify and Post-award (parts E, G) are not wired: no real data shown yet |
| "Ministry of Education, Government of India" | "Prototype · Smart India Hackathon 2026" | Not an official service |
| Helpline, helpdesk email, "Secure / Transparent / Student Friendly" footer | Omitted; help card says there is no helpline; footer shows the prototype notice | Invented content |
| "72% complete", fixed deadlines, "saved automatically" | "Step n of 4" only | No computed progress; drafts are saved explicitly |
| "AI pre-check completed" node, "7-10 working days" | Journey nodes are the real workflow stages from the stage history; target dates from the stage due date | Invented content |
| "SMS and email notifications enabled" | In-app unread count, message language and consent statuses | The API exposes no SMS/email channel state |
| Four score components (34/40 ...) | The breakdown exactly as returned (fields as rows; bars only for parts with value and maximum) | Invented content |
| "Download result" | Omitted | No route |
| "Response by" | "Target date" (with overdue / due-today wording) | Stage limits are targets in this prototype |
| Aadhaar / DigiLocker "Verified", "% match" (review_details.png) | Not built (part E optional, not done) | No such data in the API |
| Upload row shows file name as title | Document name as title, file name and size below | The checklist slot is what the applicant must supply |
| Apply size limit "10 MB" | "10 MiB"; size/type checked by the backend and its 413/415 message shown | Real limit is 10 × 1024 × 1024 bytes |
