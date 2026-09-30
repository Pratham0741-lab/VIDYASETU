/**
 * Message keys for scheme-config validation problems (Phase 14 loose ends,
 * Part A). The API returns the key, its parameters and the English text;
 * clients render the key in the user's language from this catalogue.
 *
 * Hindi: MACHINE-DRAFTED, NOT VERIFIED - review before the demo
 * (docs/TRANSLATION_REVIEW.md). scheme-authoring.spec.ts enforces en/hi parity.
 */
export const SCHEME_CONFIG_MESSAGES: Record<'en' | 'hi', Record<string, string>> = {
  en: {
    'scheme_config.schema_violation':
      'The config does not match the scheme config schema at {path}: {detail}.',
    'scheme_config.expr_blank': 'Rule {rule_id} has an empty expression.',
    'scheme_config.duplicate_rule_id': 'Rule id {rule_id} is used more than once.',
    'scheme_config.expr_unparseable': 'Rule {rule_id} cannot be read by the rules engine: {detail}',
    'scheme_config.param_missing':
      'Rule {rule_id} reads params.{param} but its params have no {param}.',
    'scheme_config.unknown_workflow':
      'Workflow {workflow} does not exist. Known workflows: {known}.',
    'scheme_config.benefit_condition_unparseable':
      'Benefit {benefit_id} has a condition the rules engine cannot read: {detail}',
    'scheme_config.too_large': 'The config is larger than {max_bytes} bytes.',
    'scheme_config.selection_policy_invalid':
      'The declared selection policy cannot be used: {detail}',
  },
  hi: {
    'scheme_config.schema_violation':
      'कॉन्फ़िग {path} पर योजना कॉन्फ़िग स्कीमा से मेल नहीं खाता: {detail}।',
    'scheme_config.expr_blank': 'नियम {rule_id} का व्यंजक खाली है।',
    'scheme_config.duplicate_rule_id': 'नियम आईडी {rule_id} एक से अधिक बार उपयोग हुई है।',
    'scheme_config.expr_unparseable': 'नियम {rule_id} को नियम इंजन नहीं पढ़ सकता: {detail}',
    'scheme_config.param_missing':
      'नियम {rule_id} params.{param} पढ़ता है, पर उसके params में {param} नहीं है।',
    'scheme_config.unknown_workflow':
      'वर्कफ़्लो {workflow} मौजूद नहीं है। ज्ञात वर्कफ़्लो: {known}।',
    'scheme_config.benefit_condition_unparseable':
      'लाभ {benefit_id} की शर्त को नियम इंजन नहीं पढ़ सकता: {detail}',
    'scheme_config.too_large': 'कॉन्फ़िग {max_bytes} बाइट से बड़ा है।',
    'scheme_config.selection_policy_invalid': 'घोषित चयन नीति उपयोग नहीं की जा सकती: {detail}',
  },
};

export function schemeConfigMessage(
  key: string,
  params: Record<string, string | number>,
  locale: 'en' | 'hi' = 'en',
): string {
  const template = SCHEME_CONFIG_MESSAGES[locale][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`,
  );
}
