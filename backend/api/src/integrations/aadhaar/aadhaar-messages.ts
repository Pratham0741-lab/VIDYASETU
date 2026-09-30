/**
 * Message keys for Aadhaar authentication (Phase 14 loose ends, Part E).
 * The API returns the key with the English text; clients render the key in
 * the user's language from this catalogue.
 *
 * Hindi: MACHINE-DRAFTED, NOT VERIFIED - review before the demo
 * (docs/TRANSLATION_REVIEW.md). aadhaar.spec.ts enforces en/hi parity.
 */
export const AADHAAR_MESSAGES: Record<'en' | 'hi', Record<string, string>> = {
  en: {
    'aadhaar.invalid_number':
      'Enter your 12-digit Aadhaar number. The number entered is not a valid Aadhaar number.',
    'aadhaar.consent_required':
      'Your consent is needed to authenticate your Aadhaar number with UIDAI.',
    'aadhaar.mock_synthetic_only':
      'This test system accepts only synthetic test numbers, never a real Aadhaar number.',
    'aadhaar.outcome.AUTHENTICATED': 'Your Aadhaar number was authenticated.',
    'aadhaar.outcome.NOT_AUTHENTICATED': 'Your Aadhaar number could not be authenticated.',
    'aadhaar.error.100':
      'The name on your profile does not match the Aadhaar record. Check the spelling and try again.',
    'aadhaar.error.998': 'This Aadhaar number is not available for authentication.',
    'aadhaar.timeout': 'The Aadhaar service did not answer in time. Please try again later.',
    'aadhaar.unavailable': 'Aadhaar authentication is not available right now.',
  },
  hi: {
    'aadhaar.invalid_number':
      'अपना 12 अंकों का आधार नंबर दर्ज करें। दर्ज किया गया नंबर मान्य आधार नंबर नहीं है।',
    'aadhaar.consent_required':
      'UIDAI से आपके आधार नंबर के प्रमाणीकरण के लिए आपकी सहमति आवश्यक है।',
    'aadhaar.mock_synthetic_only':
      'यह परीक्षण प्रणाली केवल कृत्रिम परीक्षण नंबर स्वीकार करती है, कभी भी वास्तविक आधार नंबर नहीं।',
    'aadhaar.outcome.AUTHENTICATED': 'आपका आधार नंबर प्रमाणित हो गया।',
    'aadhaar.outcome.NOT_AUTHENTICATED': 'आपका आधार नंबर प्रमाणित नहीं हो सका।',
    'aadhaar.error.100':
      'आपकी प्रोफ़ाइल का नाम आधार रिकॉर्ड से मेल नहीं खाता। वर्तनी जाँचकर फिर से प्रयास करें।',
    'aadhaar.error.998': 'यह आधार नंबर प्रमाणीकरण के लिए उपलब्ध नहीं है।',
    'aadhaar.timeout': 'आधार सेवा ने समय पर उत्तर नहीं दिया। कृपया बाद में फिर से प्रयास करें।',
    'aadhaar.unavailable': 'आधार प्रमाणीकरण अभी उपलब्ध नहीं है।',
  },
};
