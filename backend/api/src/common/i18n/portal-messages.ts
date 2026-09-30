/**
 * Phase 17.2: message keys for the portal read routes, in English and Hindi.
 *
 * - document.file.*: the refusal of GET /documents/:id/file for a stored type
 *   that is not served (details.message_key of the 415 response).
 * - history.action.<trigger_action>: labels for the trigger_action values
 *   GET /applications/:id/history returns (the route returns the value; the
 *   portal shows the label for the user's language).
 * - objection.status.<status>: labels for GET /selection-lists/:id/objections.
 *
 * The Hindi texts are machine-drafted and await review (docs/TRANSLATION_REVIEW.md).
 */
export const PORTAL_MESSAGES: Readonly<Record<'en' | 'hi', Readonly<Record<string, string>>>> = {
  en: {
    'document.file.unsupported_type':
      'This document is stored in a format that cannot be shown here. Ask the applicant to upload it again as a JPEG, PNG, WebP image or a PDF.',
    'history.action.eligibility_passed': 'Automatic eligibility check passed',
    'history.action.eligibility_indeterminate': 'Automatic eligibility check needs a manual review',
    'history.action.eligibility_failed': 'Automatic eligibility check not passed',
    'history.action.verify': 'Verified and sent to the next level',
    'history.action.reject': 'Rejected',
    'history.action.mark_defective': 'Returned for corrections',
    'history.action.resubmit': 'Resubmitted after corrections',
    'history.action.disburse': 'Disbursed',
    'objection.status.OPEN': 'Received',
    'objection.status.IN_PROGRESS': 'Under review',
    'objection.status.RESOLVED': 'Decided: upheld',
    'objection.status.REJECTED': 'Decided: not upheld',
  },
  hi: {
    'document.file.unsupported_type':
      'यह दस्तावेज़ ऐसे प्रारूप में संग्रहीत है जिसे यहाँ नहीं दिखाया जा सकता। आवेदक से इसे JPEG, PNG, WebP चित्र या PDF के रूप में फिर से अपलोड करने को कहें।',
    'history.action.eligibility_passed': 'स्वचालित पात्रता जाँच सफल',
    'history.action.eligibility_indeterminate':
      'स्वचालित पात्रता जाँच के लिए मैनुअल समीक्षा आवश्यक',
    'history.action.eligibility_failed': 'स्वचालित पात्रता जाँच सफल नहीं',
    'history.action.verify': 'सत्यापित और अगले स्तर पर भेजा गया',
    'history.action.reject': 'अस्वीकृत',
    'history.action.mark_defective': 'सुधार के लिए लौटाया गया',
    'history.action.resubmit': 'सुधार के बाद पुनः जमा किया गया',
    'history.action.disburse': 'राशि वितरित',
    'objection.status.OPEN': 'प्राप्त',
    'objection.status.IN_PROGRESS': 'समीक्षाधीन',
    'objection.status.RESOLVED': 'निर्णय: स्वीकार',
    'objection.status.REJECTED': 'निर्णय: अस्वीकार',
  },
};

/** The text for a key in a locale, falling back to English (never throws). */
export function portalMessage(key: string, locale: string): string {
  const table = PORTAL_MESSAGES[locale === 'hi' ? 'hi' : 'en'];
  return table[key] ?? PORTAL_MESSAGES.en[key] ?? key;
}
