import { call, enc, login, state, upload, waitProcessed } from '../lib.mjs';
import { psql } from '../psql.mjs';
const slot = 'Family Income Certificate';
const ino = await login('ino.ranchi.p11@example.org');
const up = async (k, cert) => {
  const t = await login(state.P[k].email);
  const r = await upload(t, state.P[k].applicationId, slot, `clean;type=${enc(slot)};holder_name=Test%20Holder;certificate_number=${enc(cert)};n=${k}`);
  await waitProcessed(t, r.body.document_id);
  console.log(`${k} uploads income certificate read as ${JSON.stringify(cert)}: HTTP ${r.status} extracted certificate_number at rest=${psql(`SELECT (extracted_data->'certificate_number')::text FROM document_extractions WHERE document_id='${r.body.document_id}';`)}`);
};
await up('M11D', 'JH-INC-2026-M1160');
await up('M11F', 'jh inc 2026 m1160');
for (const k of ['M11D', 'M11F']) {
  const r = await call('POST', `/applications/${state.P[k].applicationId}/fraud-checks`, undefined, ino, { raw: true });
  console.log(`fraud-checks ${k}: HTTP ${r.status} new_flags=${r.body.run.new_flags} flags=${JSON.stringify(r.body.flags.map((f) => `${f.flag_type}/${f.severity}/${f.evidence.field}/${JSON.stringify(f.evidence.sources)}`))}`);
}
