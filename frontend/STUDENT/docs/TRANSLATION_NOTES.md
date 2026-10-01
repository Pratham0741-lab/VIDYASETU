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
| `schemes.description` | Active scheme versions, as the VIDYASETU backend lists them. Opening this page or the home page reloads the list when it is more than 30 seconds old; use Refresh to reload it now. | सक्रिय योजना संस्करण, जैसे VIDYASETU बैकएंड उन्हें सूचीबद्ध करता है। सूची 30 सेकंड से पुरानी होने पर यह पेज या होम पेज खोलते ही वह फिर से लोड होती है; अभी लोड करने के लिए रीफ़्रेश दबाएँ। |
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
| `detail.back` | All schemes | सभी योजनाएँ |
| `detail.allSchemes` | See all schemes | सभी योजनाएँ देखें |
| `detail.loadingTitle` | Loading scheme… | योजना लोड हो रही है… |
| `detail.notFoundTitle` | Scheme not found | योजना नहीं मिली |
| `detail.notFoundText` | No active scheme has the code {code}. | {code} कोड वाली कोई सक्रिय योजना नहीं है। |
| `detail.notFoundHint` | It may have been retired, or the link may be wrong. | हो सकता है वह बंद हो गई हो, या लिंक गलत हो। |
| `detail.checkThis` | Check eligibility for this scheme | इस योजना के लिए पात्रता जाँचें |
| `detail.apply` | Apply | आवेदन करें |
| `detail.fieldsEyebrow` | From the scheme rules | योजना नियमों से |
| `detail.fieldsTitle` | What you have to fill in | आपको क्या भरना है |
| `detail.fieldsText` | The details this scheme's rules read, as the backend lists them. | इस योजना के नियम जो विवरण पढ़ते हैं, जैसे बैकएंड उन्हें सूचीबद्ध करता है। |
| `detail.noFields` | The backend lists no fields for this scheme. | बैकएंड इस योजना के लिए कोई फ़ील्ड नहीं बताता। |
| `detail.groupProfile` | From your registration | आपके पंजीकरण से |
| `detail.groupProfileHint` | Recorded once when you register; officers check them. | पंजीकरण के समय एक बार दर्ज; अधिकारी इनकी जाँच करते हैं। |
| `detail.groupApplication` | In the application form | आवेदन फ़ॉर्म में |
| `detail.groupApplicationHint` | Your institution and course, entered when you apply. | आपका संस्थान और पाठ्यक्रम, आवेदन के समय भरा जाता है। |
| `detail.groupScheme` | Asked by this scheme's rules | इस योजना के नियमों द्वारा पूछा गया |
| `detail.groupSchemeHint` | Extra questions you answer in the scheme form. | अतिरिक्त प्रश्न जिनका उत्तर आप योजना फ़ॉर्म में देते हैं। |
| `detail.options` | Allowed: {options} | मान्य: {options} |
| `detail.limit` | Limit {values} | सीमा {values} |
| `detail.eligibilityTitle` | Eligibility | पात्रता |
| `detail.eligibilityText` | Eligibility is checked against your details when you use the eligibility checker or submit an application. | जब आप पात्रता जाँच का उपयोग करते हैं या आवेदन जमा करते हैं, तब आपके विवरण से पात्रता जाँची जाती है। |
| `detail.docsTitle` | Documents to upload | अपलोड करने वाले दस्तावेज़ |
| `detail.noDocs` | The backend lists no documents for this scheme. | बैकएंड इस योजना के लिए कोई दस्तावेज़ नहीं बताता। |
| `detail.required` | Required | आवश्यक |
| `detail.requiredDoc` | Listed as a required document | आवश्यक दस्तावेज़ के रूप में सूचीबद्ध |
| `detail.ruleDocsIntro` | Also checked by the scheme rules: | योजना नियमों द्वारा भी जाँचे जाते हैं: |
| `detail.usedBy` | Used by: {rules} | इनके द्वारा उपयोग: {rules} |
| `detail.unparseable` | {n} rule(s) of this scheme could not be read by the backend. | इस योजना के {n} नियम बैकएंड नहीं पढ़ सका। |
| `formField.category` | Category | श्रेणी |
| `formField.family_income_annual` | Annual family income | वार्षिक पारिवारिक आय |
| `formField.education_level` | Education level | शिक्षा स्तर |
| `formField.academic_year_number` | Year of course | पाठ्यक्रम का वर्ष |
| `formField.age` | Age | आयु |
| `formField.gender` | Gender | लिंग |
| `formField.is_disabled` | Person with disability | दिव्यांग व्यक्ति |
| `formField.disability_percentage` | Disability percentage | दिव्यांगता प्रतिशत |
| `formField.domicile_state` | State of domicile | अधिवास राज्य |
| `formField.domicile_district` | District of domicile | अधिवास ज़िला |
| `formField.institution_name` | Institution | संस्थान |
| `formField.institution_code` | Institution code | संस्थान कोड |
| `formField.course_name` | Course | पाठ्यक्रम |
| `formField.is_hosteller` | Living in a hostel | छात्रावास में रहते हैं |
| `slot.admission_offer_letter` | Admission offer letter | प्रवेश प्रस्ताव पत्र |
| `landing.browseTitle` | Browse all schemes | सभी योजनाएँ देखें |
| `landing.browseText` | Every scheme open for applications, as the backend lists it. Open one to see what it asks for. | आवेदन के लिए खुली हर योजना, जैसे बैकएंड उसे सूचीबद्ध करता है। उसमें क्या माँगा जाता है, यह देखने के लिए उसे खोलें। |
| `landing.viewAll` | View all schemes ({n}) | सभी योजनाएँ देखें ({n}) |
| `checker.selectedScheme` | Selected scheme | चुनी गई योजना |
| `apply.schemeNotOpen` | The scheme {code} is not open for applications right now. Choose another scheme below. | योजना {code} अभी आवेदन के लिए खुली नहीं है। नीचे कोई और योजना चुनें। |
| `brand.tagline` (UI v2) | Prototype · Smart India Hackathon 2026 | प्रोटोटाइप · स्मार्ट इंडिया हैकाथॉन 2026 |
| `brand.full` (UI v2) | VidyaSetu: Prototype · Smart India Hackathon 2026 | विद्यासेतु: प्रोटोटाइप · स्मार्ट इंडिया हैकाथॉन 2026 |
| `nav.stepDone` | (completed) | (पूरा हुआ) |
| `header.notifications` | Notifications | सूचनाएँ |
| `header.notificationsUnread` | Notifications: {n} unread | सूचनाएँ: {n} अपठित |
| `def.respondBy` (UI v2) | Target date | लक्ष्य तिथि |
| `def.overdue` (UI v2) | The target date has passed | लक्ष्य तिथि निकल चुकी है |
| `def.deadlineText` (UI v2) | Please respond by the deadline. | कृपया समय सीमा तक जवाब दें। |
| `def.itemDeadline` (UI v2) | Target date | लक्ष्य तिथि |
| `def.progressHint` (UI v2) | You can submit once at least one correction is uploaded. | कम से कम एक सुधार अपलोड होने पर आप जमा कर सकते हैं। |
| `def.dueToday` | Due today | आज अंतिम दिन |
| `def.uploadedLive` | {doc}: replacement uploaded | {doc}: नया दस्तावेज़ अपलोड हो गया |
| `def.uploadingLive` | {doc}: uploading… | {doc}: अपलोड हो रहा है… |
| `dash.cardStage` (UI v2) | Next expected update | अगला अपेक्षित अपडेट |
| `dash.dueBy` (UI v2) | Target date: {date} | लक्ष्य तिथि: {date} |
| `dash.cardDocs` / `dash.cardNotes` / `dash.applicationId` (UI v2, sentence case) | Documents / Notifications / Application number | दस्तावेज़ / सूचनाएँ / आवेदन संख्या |
| `dash.titleNoName` | Your application | आपका आवेदन |
| `dash.cardContact` | Contact and consent | संपर्क और सहमति |
| `dash.contactInApp` | In-app notifications: {n} unread | ऐप में सूचनाएँ: {n} अपठित |
| `dash.contactLanguage` | Messages in: {lang} | संदेशों की भाषा: {lang} |
| `dash.consentsGiven` | {n} of {m} consents given | {m} में से {n} सहमतियाँ दी गईं |
| `dash.manageConsent` | Review consent | सहमति देखें |
| `dash.journeyStep` | Step {n} | चरण {n} |
| `result.howText` (UI v2) | Exactly as the backend recorded it for your application. | ठीक वैसा ही जैसा बैकएंड ने आपके आवेदन के लिए दर्ज किया है। |
| `result.congratsNoName` | Congratulations | बधाई हो |
| `result.outOf` | {value} of {max} | {max} में से {value} |
| `apply.fileHint` / `apply.tip4` / `apply.tooLarge` (UI v2: MiB, the real limit) | PDF, JPG or PNG · up to 10 MiB | PDF, JPG या PNG · अधिकतम 10 MiB |
| `apply.stepN` (UI v2, sentence case) | Step {n} | (unchanged) |
| `apply.statusLive` | {doc}: {status} | {doc}: {status} |
| `apply.stepCurrent` / `apply.stepDone` | (current step) / (completed) | (मौजूदा चरण) / (पूरा हुआ) |
| `field.ifsc` / `field.accountNumber` | IFSC code / Account number | IFSC कोड / खाता संख्या |
| `field.ifscHint` / `field.accountNumberHint` | 11 characters, for example SBIN0001234 / 9 to 18 digits | 11 अक्षर, उदाहरण SBIN0001234 / 9 से 18 अंक |
| `field.ifscError` | Enter a valid IFSC: 4 letters, then 0, then 6 letters or digits. | मान्य IFSC दर्ज करें: 4 अक्षर, फिर 0, फिर 6 अक्षर या अंक। |
| `field.accountNumberError` | Enter an account number of 9 to 18 digits. | 9 से 18 अंकों की खाता संख्या दर्ज करें। |
| `doc.outcome.MISSING` (multi-upload) | Waiting | प्रतीक्षा में |
| `apply.uploadDocuments` | Upload documents | दस्तावेज़ अपलोड करें |
| `apply.dropText` | Drop your files here, or choose them. Each file is placed in the matching row after it is scanned. | अपनी फ़ाइलें यहाँ छोड़ें या चुनें। स्कैन के बाद हर फ़ाइल सही पंक्ति में रखी जाती है। |
| `apply.noRowLeft` | {name}: every document is already verified; use Replace on a row to change one. | {name}: सभी दस्तावेज़ पहले से सत्यापित हैं; किसी को बदलने के लिए उस पंक्ति में बदलें चुनें। |
| `apply.replaceNamed` | Replace {doc} | {doc} बदलें |
| `doc.reason.type_uncertain` (multi-upload) | Needs attention: officer will check (the document type could not be detected). | ध्यान दें: अधिकारी जाँच करेंगे (दस्तावेज़ का प्रकार पहचाना नहीं जा सका)। |
