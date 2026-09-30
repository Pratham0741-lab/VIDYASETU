/**
 * Hindi notification texts (Phase 13D). Same keys and the same {placeholders}
 * as the English texts in templates.ts; templates.spec.ts fails if a key or
 * placeholder is missing.
 *
 * MACHINE-DRAFTED, NOT VERIFIED: every string in this file needs review by a
 * fluent Hindi speaker before the demo (docs/TRANSLATION_REVIEW.md).
 */
export const TEMPLATES_HI: Record<string, { subject: string; body: string }> = {
  'application.eligible_under_review': {
    subject: 'आवेदन {application_no}: पात्रता जाँच में सफल',
    body: 'आपका आवेदन {application_no} स्वचालित पात्रता जाँच में सफल रहा और अब सत्यापन के लिए {stage_label} के पास है ({due_at} तक)।',
  },
  'application.ineligible_defective': {
    subject: 'आवेदन {application_no}: कार्रवाई आवश्यक',
    body: 'आपका आवेदन {application_no} स्वचालित पात्रता जाँच में सफल नहीं हुआ:\n{failed_rules}\nआप अपना विवरण सुधारकर आवेदन दोबारा जमा कर सकते हैं।',
  },
  'application.manual_eligibility_review': {
    subject: 'आवेदन {application_no}: मैनुअल जाँच में',
    body: 'स्वचालित जाँच आवेदन {application_no} की पात्रता तय नहीं कर सकी। एक अधिकारी इसकी जाँच करेंगे; अभी आपको कुछ करने की आवश्यकता नहीं है।',
  },
  'application.advanced': {
    subject: 'आवेदन {application_no}: सत्यापित',
    body: 'आपका आवेदन {application_no} सत्यापित हुआ और {from_label} से {to_label} को भेजा गया।',
  },
  'application.rejected': {
    subject: 'आवेदन {application_no}: अस्वीकृत',
    body: 'आपका आवेदन {application_no} {from_label} स्तर पर अस्वीकृत हुआ।',
  },
  'application.deficiency_raised': {
    subject: 'आवेदन {application_no}: कमी {deficiency_code}',
    body: 'एक अधिकारी को आपके आवेदन {application_no} में कमी मिली।\nकोड: {deficiency_code}\nसमस्या: {deficiency_title}\nकृपया {due_at} तक सुधारकर दोबारा जमा करें।',
  },
  'document.retake_required': {
    subject: 'आवेदन {application_no}: कृपया "{document_type}" फिर से अपलोड करें',
    body: '"{document_type}" के लिए अपलोड की गई फ़ाइल पढ़ी नहीं जा सकी:\n{issues}\nकृपया अधिक साफ़ प्रति अपलोड करें।',
  },
  'officer.application_arrived': {
    subject: 'नया आवेदन {application_no} आपके सत्यापन की प्रतीक्षा में',
    body: 'आवेदन {application_no} ({jurisdiction}) अब {stage_label} पर है और आपकी कार्रवाई की प्रतीक्षा में है ({due_at} तक)।',
  },
  'officer.manual_eligibility_review_needed': {
    subject: 'आवेदन {application_no} की मैनुअल पात्रता जाँच आवश्यक',
    body: 'स्वचालित जाँच आवेदन {application_no} ({jurisdiction}) तय नहीं कर सकी। जिन नियमों का मूल्यांकन नहीं हो सका: {error_rules}। सत्यापन करते समय जाँच की पुष्टि करें।',
  },
  'officer.application_resubmitted': {
    subject: 'आवेदन {application_no} दोबारा जमा हुआ',
    body: 'आवेदन {application_no} ({jurisdiction}) दोबारा जमा हुआ और फिर से {stage_label} पर है।',
  },
  'officer.document_needs_review': {
    subject: 'आवेदन {application_no}: दस्तावेज़ "{document_slot}" की जाँच आवश्यक',
    body: 'आवेदन {application_no} का दस्तावेज़ "{document_slot}" जाँच के लिए भेजा गया।\nजाँचने योग्य फ़ील्ड: {fields}\nकारण: {reasons}',
  },
  'officer.documents_inconsistent': {
    subject: 'आवेदन {application_no}: दस्तावेज़ आपस में मेल नहीं खाते',
    body: 'आवेदन {application_no} के दस्तावेज़ आपस में मेल नहीं खाते ({checks})। आवेदन पर कार्रवाई से पहले उनकी जाँच करें।',
  },
  'officer.documents_consistency_uncertain': {
    subject: 'आवेदन {application_no}: दस्तावेज़ों का मिलान अनिश्चित',
    body: 'आवेदन {application_no} की मिलान जाँच का परिणाम स्पष्ट नहीं है ({checks})। कृपया दस्तावेज़ों की जाँच करें।',
  },
  'officer.documents_now_consistent': {
    subject: 'आवेदन {application_no}: दस्तावेज़ अब मेल खाते हैं',
    body: 'आवेदन {application_no} के दस्तावेज़ अब आपस में मेल खाते हैं; पहले की चेतावनी समाप्त हो गई है।',
  },
  'officer.eligibility_recheck_needed': {
    subject: 'आवेदन {application_no}: दस्तावेज़ पात्रता डेटा से मेल नहीं खाता',
    body: 'आवेदन {application_no} का एक दस्तावेज़ पात्रता मूल्यांकन में प्रयुक्त डेटा से मेल नहीं खाता: {fields}। आवेदन को मैनुअल पात्रता जाँच के लिए चिह्नित किया गया है।',
  },
  'selection.provisionally_selected': {
    subject: '{scheme_code} {academic_year}: अस्थायी रूप से चयनित',
    body: 'आपका आवेदन {application_no} {scheme_code} {academic_year} के लिए अस्थायी रूप से चयनित है।\nमेरिट रैंक: {merit_rank}\nश्रेणी सीट: {vertical_category}\nआरक्षण: {reservation}',
  },
  'selection.not_selected': {
    subject: '{scheme_code} {academic_year}: चयन परिणाम',
    body: 'आपका आवेदन {application_no} {scheme_code} {academic_year} के लिए चयनित नहीं हुआ।\nमेरिट रैंक: {merit_rank}\nकारण: {reason}\nचयन संदर्भ: {selection_run_id} (आपत्ति करते समय इसका उल्लेख करें)।',
  },
  'grievance.registered': {
    subject: 'आवेदन {application_no} पर शिकायत दर्ज',
    body: 'आवेदन {application_no} पर आपकी शिकायत ({subject}) दर्ज हो गई है। संदर्भ: {grievance_id}। इस पर {due_at} तक कार्रवाई होगी।',
  },
  'grievance.in_progress': {
    subject: 'शिकायत {grievance_id}: जाँच जारी',
    body: 'एक अधिकारी ने आवेदन {application_no} पर आपकी शिकायत ({subject}) की जाँच शुरू की है। अपेक्षित समय: {due_at}।',
  },
  'privacy.correction_decided': {
    subject: 'आपका सुधार अनुरोध {request_id}: {decision_label}',
    body: 'आपके {field_label} में सुधार का अनुरोध {decision_label}।\nअधिकारी की टिप्पणी: {officer_reason}',
  },
  'grievance.resolved': {
    subject: 'शिकायत {grievance_id}: निपटाई गई',
    body: 'आवेदन {application_no} पर आपकी शिकायत ({subject}) का निपटारा हो गया है।\nअधिकारी की टिप्पणी: {resolution_note}',
  },
  'grievance.rejected': {
    subject: 'शिकायत {grievance_id}: बिना कार्रवाई बंद',
    body: 'आवेदन {application_no} पर आपकी शिकायत ({subject}) बिना कार्रवाई के बंद कर दी गई।\nअधिकारी की टिप्पणी: {resolution_note}',
  },
  'officer.sla_breached': {
    subject: 'एसएलए समय-सीमा पार: आवेदन {application_no}',
    body: 'आवेदन {application_no} ({jurisdiction}) {stage_entered_at} से {stage_label} पर है और इसकी {sla_days} दिन की एसएलए समय-सीमा {due_at} को पार हो गई। कृपया इस पर कार्रवाई करें।',
  },
  'officer.grievance_raised': {
    subject: 'आवेदन {application_no} पर नई शिकायत',
    body: 'आवेदन {application_no} ({jurisdiction}) पर एक शिकायत ({subject}) दर्ज हुई है। संदर्भ: {grievance_id}। {due_at} तक उत्तर दें।',
  },
  'selection.list_provisional': {
    subject: '{scheme_code} {academic_year}: अस्थायी सूची प्रकाशित',
    body: '{scheme_code} {academic_year} की अस्थायी चयन सूची प्रकाशित हो गई है।\nआपका आवेदन {application_no}: {outcome}\nमेरिट रैंक: {merit_rank}\n{window_closes_at} तक आपत्ति दर्ज की जा सकती है।',
  },
  'selection.list_final': {
    subject: '{scheme_code} {academic_year}: अंतिम सूची प्रकाशित',
    body: '{scheme_code} {academic_year} की अंतिम चयन सूची प्रकाशित हो गई है।\nआपका आवेदन {application_no}: {outcome}\nमेरिट रैंक: {merit_rank}',
  },
  'officer.selection_run_summary': {
    subject: '{scheme_code} {academic_year} का चयन पूरा',
    body: '{scheme_code} {academic_year} का चयन ({basis}) पूरा हुआ: {selected} चयनित, {not_selected} चयनित नहीं।',
  },
};

/** Hindi texts of the Phase 3 rule message keys (templates.ts RULE_MESSAGES). */
export const RULE_MESSAGES_HI: Record<string, string> = {
  'err.age_limit_exceeded': 'आपकी आयु इस योजना की आयु सीमा से अधिक है।',
  'err.category_ineligible': 'आपकी श्रेणी इस योजना के लिए पात्र नहीं है।',
  'err.course_duration_exceeded': 'पाठ्यक्रम का वर्ष इस योजना की अवधि से आगे है।',
  'err.education_level_ineligible': 'आपका शिक्षा स्तर इस योजना में शामिल नहीं है।',
  'err.fellowship_tenure_exceeded': 'आपकी डिग्री के लिए फ़ेलोशिप की अवधि सीमा पार हो गई है।',
  'err.income_ceiling_exceeded': 'आपके परिवार की वार्षिक आय इस योजना की आय सीमा से अधिक है।',
  'err.overseas_tenure_exceeded': 'विदेश में पढ़ाई के लिए पाठ्यक्रम की अवधि सीमा से अधिक है।',
  'err.pre_matric_class_or_tenure_exceeded': 'कक्षा या अवधि इस योजना के दायरे से बाहर है।',
  'err.top_class_tenure_exceeded': 'पाठ्यक्रम की अवधि इस योजना की सीमा से अधिक है।',
  'info.disbursement_schedule': 'भुगतान योजना की समय-सारणी के अनुसार होगा।',
  'info.nfst_merit_score': 'मेरिट NFST मेरिट अंक के आधार पर है।',
  'info.no_income_ceiling': 'इस योजना में कोई आय सीमा नहीं है।',
  'info.nos_selection_priority': 'चयन की प्राथमिकता NOS नियमों के अनुसार है।',
  'info.slots_distribution': 'स्थान योजना के अनुसार बाँटे जाते हैं।',
};

/** Hindi texts of the image-quality issue keys (templates.ts QUALITY_ISSUE_MESSAGES). */
export const QUALITY_ISSUE_MESSAGES_HI: Record<string, string> = {
  'quality.blurred': 'चित्र धुंधला है, इसलिए लिखावट साफ़ नहीं पढ़ी जा सकती।',
  'quality.image_blurred': 'चित्र धुंधला है, इसलिए लिखावट साफ़ नहीं पढ़ी जा सकती।',
  'quality.low_resolution': 'चित्र का रिज़ॉल्यूशन बहुत कम है, लिखावट पढ़ी नहीं जा सकती।',
  'quality.glare_detected': 'चमक या परछाईं के कारण पृष्ठ का कुछ भाग दिखाई नहीं देता।',
  'quality.underexposed': 'चित्र बहुत गहरा है, लिखावट पढ़ी नहीं जा सकती।',
  'quality.cut_off_edge': 'दस्तावेज़ का कुछ भाग चित्र के किनारे पर कटा हुआ है।',
  'quality.page_cropped': 'दस्तावेज़ का कुछ भाग चित्र के किनारे पर कटा हुआ है।',
  'quality.unknown': 'चित्र में ऐसी समस्या है जिससे उसे पढ़ा नहीं जा सकता।',
  'quality.pdf_encrypted': 'PDF पासवर्ड से सुरक्षित है। बिना पासवर्ड वाली प्रति अपलोड करें।',
  'quality.pdf_unreadable': 'PDF फ़ाइल खराब है या खोली नहीं जा सकती।',
  'quality.pdf_too_large': 'PDF का पृष्ठ बहुत बड़ा है। सामान्य आकार के पृष्ठ का स्कैन अपलोड करें।',
};
