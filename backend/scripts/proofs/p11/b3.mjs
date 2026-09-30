import { writeFileSync } from 'node:fs';
import { call, enc, login, save, state, upload, waitProcessed } from './lib.mjs';
import { psql } from './psql.mjs';
const slot = 'Family Income Certificate';
const P = state.P, ino = await login('ino.ranchi.p11@example.org');
const OLD = 'JH-INC-2026-D1X01', NEW = 'JH-INC-2026-G115Y', OCRD = 'JH-INC-2026-G115Z';
const step = process.argv[2];
if (step === 'before') {
  console.log(`positive control (pre-fix extraction value '${OLD}'): document_extractions rows=${psql(`SELECT count(*) FROM document_extractions x WHERE row_to_json(x)::text LIKE '%${OLD}%';`)}, audit_logs rows=${psql(`SELECT count(*) FROM audit_logs x WHERE row_to_json(x)::text LIKE '%${OLD}%';`)}`);
  console.log(`extractions holding certificate_number as text: ${psql(`SELECT count(*) FROM document_extractions WHERE jsonb_typeof(extracted_data->'certificate_number')='string';`)}`);
}
if (step === 'new') {
  state.B3 ??= {};
  if (!state.B3.g1) {
  const g2 = await upload(await login(P.G2.email), P.G2.applicationId, slot, `clean;type=${enc(slot)};holder_name=Kavya%20Oraon;certificate_number=${NEW};n=g2`);
  await waitProcessed(await login(P.G2.email), g2.body.document_id);
  const g1 = await upload(await login(P.G1.email), P.G1.applicationId, slot, `low_confidence_field;type=${enc(slot)};low=certificate_number;holder_name=Kavya%20Oraon;certificate_number=${OCRD};n=g1`);
  await waitProcessed(await login(P.G1.email), g1.body.document_id);
  state.B3 = { g1: g1.body.document_id, g2: g2.body.document_id }; save();
  console.log(`G2 upload HTTP ${g2.status} doc=${g2.body.document_id}; G1 upload HTTP ${g1.status} doc=${g1.body.document_id}`);
  }
  for (const [k, id] of [['G2', state.B3.g2], ['G1', state.B3.g1]]) {
    console.log(`  ${k} extraction at rest: ` + psql(`SELECT 'review_status='||review_status||' extracted_data.certificate_number='||(extracted_data->'certificate_number')::text||' sensitive_values='||CASE WHEN sensitive_values IS NULL THEN 'null' ELSE octet_length(sensitive_values)||' bytes' END FROM document_extractions WHERE document_id='${id}';`));
  }
  const view = await call('GET', `/documents/${state.B3.g1}`, undefined, ino, { raw: true });
  const f = view.body.extraction.fields.find((x) => x.name === 'certificate_number');
  console.log(`  Phase 7 review view (INO, live): HTTP ${view.status} state=${view.body.state} certificate_number: sensitive=${f.sensitive} review=${f.review} value_equals_ocr_read=${f.value === OCRD}`);
  const c = await call('POST', `/documents/${state.B3.g1}/confirm`, { corrections: { certificate_number: NEW }, remarks: 'Corrected from the physical certificate.' }, ino, { raw: true });
  const cf = c.body.extraction?.fields?.find((x) => x.name === 'certificate_number');
  console.log(`  INO confirms G1 with a corrected number: HTTP ${c.status} state=${c.body.state} certificate_number: corrected=${cf?.corrected} review=${cf?.review} value_equals_correction=${cf?.value === NEW}`);
  console.log(`  G1 extraction at rest after confirm: ` + psql(`SELECT 'review_status='||review_status||' extracted_data.certificate_number='||(extracted_data->'certificate_number')::text||' corrected_fields='||corrected_fields::text FROM document_extractions WHERE document_id='${state.B3.g1}';`));
  for (const k of ['G1', 'G2']) {
    const r = await call('POST', `/applications/${P[k].applicationId}/fraud-checks`, undefined, ino, { raw: true });
    console.log(`  fraud-checks ${k}: HTTP ${r.status} new_flags=${r.body.run?.new_flags} flags=${JSON.stringify(r.body.flags?.map((x) => `${x.flag_type}/${x.severity}/${JSON.stringify(x.evidence.sources ?? '')}`))}`);
  }
}
