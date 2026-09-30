/**
 * Phase 17 (Part B): consent notices and privacy messages, as message keys in
 * English and Hindi. The notice text is versioned by CONSENT_NOTICE_VERSION:
 * changing the text means raising the version, and every applicant is asked
 * again.
 *
 * Hindi: MACHINE-DRAFTED, NOT VERIFIED - review before the demo
 * (docs/TRANSLATION_REVIEW.md). privacy.spec.ts enforces en/hi parity.
 */
export const PRIVACY_MESSAGES: Record<'en' | 'hi', Record<string, string>> = {
  en: {
    'consent.application_processing.title': 'Processing your scholarship application',
    'consent.application_processing.text':
      'I agree that the Ministry of Tribal Affairs and the officers of my institute, district and state may use the details and documents I give to assess my eligibility, verify my application, select scholars and pay the scholarship.',
    'consent.government_verification.title': 'Verification with government sources',
    'consent.government_verification.text':
      'I agree that my details may be checked against government records (DigiLocker, PFMS, NSP and, where I ask for it, Aadhaar authentication) to verify my documents and payments.',
    'consent.notifications.title': 'Messages about my application',
    'consent.notifications.text':
      'I agree to receive messages about my application by e-mail and SMS. In-app notices are always shown.',
    'consent.required': 'Please give your consent for {purposes} before submitting an application.',
    'privacy.erasure.recorded':
      'Your erasure request is recorded. Nothing is deleted yet. Records needed for legal, audit or scholarship purposes (applications that were decided, selections, sanction orders, payments, the audit trail) must be kept for the period the law and the scheme require; other data will be erased under the retention policy.',
    'privacy.export.masked':
      'Identifiers (caste certificate number, bank account) are shown masked, as everywhere in the portal.',
  },
  hi: {
    'consent.application_processing.title': 'आपके छात्रवृत्ति आवेदन का प्रसंस्करण',
    'consent.application_processing.text':
      'मैं सहमत हूँ कि जनजातीय कार्य मंत्रालय और मेरे संस्थान, ज़िले और राज्य के अधिकारी मेरी पात्रता का आकलन करने, मेरे आवेदन का सत्यापन करने, छात्रवृत्ति प्राप्तकर्ताओं का चयन करने और छात्रवृत्ति का भुगतान करने के लिए मेरे द्वारा दिए गए विवरण और दस्तावेज़ों का उपयोग कर सकते हैं।',
    'consent.government_verification.title': 'सरकारी स्रोतों से सत्यापन',
    'consent.government_verification.text':
      'मैं सहमत हूँ कि मेरे दस्तावेज़ों और भुगतानों के सत्यापन के लिए मेरे विवरण सरकारी अभिलेखों (डिजीलॉकर, पीएफएमएस, एनएसपी और, मेरे अनुरोध पर, आधार प्रमाणीकरण) से जाँचे जा सकते हैं।',
    'consent.notifications.title': 'मेरे आवेदन के बारे में संदेश',
    'consent.notifications.text':
      'मैं अपने आवेदन के बारे में ईमेल और एसएमएस से संदेश प्राप्त करने के लिए सहमत हूँ। ऐप के भीतर सूचनाएँ हमेशा दिखाई जाती हैं।',
    'consent.required': 'आवेदन जमा करने से पहले कृपया {purposes} के लिए अपनी सहमति दें।',
    'privacy.erasure.recorded':
      'आपका मिटाने का अनुरोध दर्ज कर लिया गया है। अभी कुछ भी हटाया नहीं गया है। कानूनी, लेखा-परीक्षा या छात्रवृत्ति के प्रयोजनों के लिए आवश्यक अभिलेख (निर्णीत आवेदन, चयन, स्वीकृति आदेश, भुगतान, लेखा-परीक्षा अभिलेख) कानून और योजना द्वारा निर्धारित अवधि तक रखे जाने चाहिए; अन्य डेटा प्रतिधारण नीति के अनुसार मिटाया जाएगा।',
    'privacy.export.masked':
      'पहचानकर्ता (जाति प्रमाणपत्र संख्या, बैंक खाता) पोर्टल में हर जगह की तरह आंशिक रूप से छिपाकर दिखाए गए हैं।',
  },
};

export function privacyMessage(key: string, locale: string, params: Record<string, string> = {}) {
  const table = PRIVACY_MESSAGES[locale === 'hi' ? 'hi' : 'en'];
  const text = table[key] ?? PRIVACY_MESSAGES.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, n: string) => params[n] ?? `{${n}}`);
}
