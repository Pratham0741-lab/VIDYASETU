# Translation notes (student portal)

## Status

- **English** (`src/i18n/en.ts`) is the source text.
- **Hindi** (`src/i18n/hi.ts`) is **machine-drafted and unreviewed**. It
  must be reviewed by a fluent Hindi speaker (and, for consent and privacy
  wording, by legal) before any real use.
- Every key of `en.ts` exists in `hi.ts`; `pnpm typecheck` fails otherwise
  (`hi` is typed `Record<MessageKey, string>`).

## What is translated where

| Text | Source | Hindi status |
|---|---|---|
| Portal UI (labels, buttons, headings, help text) | `src/i18n/en.ts`, `hi.ts` | machine-drafted, unreviewed |
| Error text for backend `code`, `details.reason`, `details.message_key` | `src/i18n/*` (`code.*`, `reason.*`, `api.*`) | machine-drafted, unreviewed |
| Deficiency problem / fix texts (`deficiency.problem.*`, `deficiency.fix.*`) | copied from the backend's notice_templates (migration `20260929110000_deficiency_items`) | the backend's own draft, also unreviewed (backend `docs/TRANSLATION_REVIEW.md`) |
| Consent notice titles and texts | served by `GET /applicants/me/consents` in the applicant's `preferred_language` | backend draft, unreviewed; not duplicated here |
| Notifications (subject, body) | rendered by the backend in `preferred_language` | backend draft, unreviewed |
| Scheme names, rule explanations, document checklist labels | backend data (scheme configuration), English only | **not translated** (no Hindi in the API) |
| Unknown backend error messages | raw backend `message` (English) | fallback only |

## Known gaps

- Scheme names, document checklist labels and rule explanations come from
  the scheme configuration in English only; Hindi users see them in
  English. Backend request R5 asks for localised scheme texts.
- The bundled fonts (DM Sans, Nunito, Newsreader, Molengo) have no
  Devanagari; Hindi text uses the operating system's Devanagari font.
- Numbers and dates use `hi-IN` / `en-IN` formatting from the browser.

## Keys added in F1-C (machine-drafted Hindi, unreviewed)

| Key | English | Hindi |
|---|---|---|
| `category.ST_OTHERS` | Scheduled Tribe (other than PVTG) | अनुसूचित जनजाति (PVTG के अलावा) |
| `reservation.FEMALE` | Women | महिला |
| `reservation.PWD` | Persons with disabilities | दिव्यांगजन |

Codes come from the backend selection code (`api/src/selection/selection-policies.ts`:
vertical categories / seat pools `ST_OTHERS`, `PVTG`; horizontal reservations
`FEMALE`, `PWD`). `category.ST` and `category.PVTG` already existed. A code
without a key is shown humanised (underscores to spaces, sentence case), e.g.
`SOME_CODE` -> "Some code".
- `history.action.mark_defective` (hi) changed to "सुधार के लिए लौटाया गया" so
  it matches `stage.DEFECTIVE`; the timeline shows an action label only when
  it differs from the stage name (F1-C).

## Keys added in F1-D (machine-drafted Hindi, unreviewed)

| Key | English | Hindi |
|---|---|---|
| `schemes.eyebrow` | Scholarship schemes | छात्रवृत्ति योजनाएँ |
| `schemes.title` | Schemes open for applications | आवेदन के लिए खुली योजनाएँ |
| `schemes.description` | Active scheme versions, as the VIDYASETU backend lists them. The list is refreshed every 30 seconds while you use the portal. | सक्रिय योजना संस्करण, जैसे VIDYASETU बैकएंड उन्हें सूचीबद्ध करता है। पोर्टल उपयोग करते समय सूची हर 30 सेकंड में ताज़ा होती है। |
| `schemes.version` | Version {n} | संस्करण {n} |
| `schemes.fromTo` | From {from} to {to} | {from} से {to} तक |
| `schemes.fromOpen` | From {from} · no end date | {from} से · कोई अंतिम तिथि नहीं |
| `schemes.viewDetails` | View details | विवरण देखें |
| `schemes.checkMine` | Check my eligibility | मेरी पात्रता जाँचें |
| `schemes.updatedAt` | Updated {time} | अपडेट: {time} |
| `schemes.refresh` | Refresh | रीफ़्रेश करें |
| `schemes.refreshWait` | Refresh in {s} s | {s} सेकंड में रीफ़्रेश |
| `schemes.search` | Search by name or code | नाम या कोड से खोजें |
| `schemes.searchPlaceholder` | e.g. NFST or fellowship | जैसे NFST या fellowship |
| `schemes.count` | {n} scheme(s) | {n} योजना(एँ) |
| `schemes.emptyTitle` | No scheme is open right now | अभी कोई योजना खुली नहीं है |
| `schemes.emptyText` | The backend lists no active scheme version. Please check again later. | बैकएंड किसी सक्रिय योजना संस्करण को सूचीबद्ध नहीं करता। कृपया बाद में फिर देखें। |
| `schemes.noMatchTitle` | No scheme matches your search | आपकी खोज से कोई योजना मेल नहीं खाती |
| `schemes.noMatchText` | Nothing matches “{q}”. Try another name or code. | “{q}” से कुछ मेल नहीं खाता। कोई और नाम या कोड आज़माएँ। |
| `schemes.englishOnly` | Scheme names are shown as the backend returns them (English only). | योजनाओं के नाम वैसे ही दिखाए गए हैं जैसे बैकएंड देता है (केवल अंग्रेज़ी में)। |
