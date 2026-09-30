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
