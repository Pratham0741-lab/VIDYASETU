import { call, enc, login, save, state, upload, waitProcessed } from './lib.mjs';
import { psql } from './psql.mjs';
const slot = 'Family Income Certificate';
const X = `clean;type=${enc(slot)};holder_name=Pooja%20Minj;certificate_number=JH-INC-2026-D1X01`;
const Y = `clean;type=${enc(slot)};holder_name=Nirmala%20Kujur;certificate_number=JH-INC-2026-D3Y01`;
const up = async (key, marker, label) => {
  const r = await upload(await login(state.P[key].email), state.P[key].applicationId, slot, marker);
  await waitProcessed(await login(state.P[key].email), r.body.document_id);
  console.log(`${label}: ${key} HTTP ${r.status} document=${r.body.document_id} sha256=${r.body.file_sha256.slice(0, 16)}...`);
  return r.body.document_id;
};
state.docs = {
  d1x: await up('D1', X, 'D1 uploads file X'),
  d3y1: await up('D3', Y, 'D3 uploads file Y'),
  d3y2: await up('D3', Y, 'D3 re-uploads the SAME file Y (own resubmission)'),
  d2x: await up('D2', X, 'D2 uploads the SAME file X'),
};
save();
const ino = await login('ino.ranchi.p11@example.org');
for (const key of ['D1', 'D3']) {
  const r = await call('POST', `/applications/${state.P[key].applicationId}/fraud-checks`, undefined, ino);
  console.log(`\nINO fraud-checks ${key}: new_flags=${r.run.new_flags} held=${r.held} flags=${JSON.stringify(r.flags.map((f) => [f.flag_type, f.severity]))}`);
}
console.log('\n--- D2: no manual check. The INO tries to verify; the hold guard runs detection itself:');
const v = await call('POST', `/applications/${state.P.D2.applicationId}/verify`, { remarks: 'verify D2' }, ino, { raw: true });
console.log(`HTTP ${v.status} ${JSON.stringify(v.body)}`);
const name = Object.fromEntries(Object.entries(state.P).map(([k, p]) => [p.applicationId, k]));
console.log('\n--- DUPLICATE_FILE_HASH / certificate flags now in the database:');
for (const r of JSON.parse(psql("SELECT coalesce(json_agg(x),'[]') FROM (SELECT flag_type, severity, application_id, related_application_ids, related_document_ids, evidence FROM fraud_flags WHERE flag_type IN ('DUPLICATE_FILE_HASH','REPEATED_CERTIFICATE_NUMBER') ORDER BY flag_type, created_at) x;")))
  console.log(`  ${r.flag_type.padEnd(28)} ${r.severity.padEnd(6)} on ${name[r.application_id]} related=${JSON.stringify(r.related_application_ids.map((i) => name[i]))} docs=${JSON.stringify(r.related_document_ids.map((d) => Object.entries(state.docs).find(([, v]) => v === d)?.[0] ?? d))}${r.evidence.sources ? ' sources=' + JSON.stringify(r.evidence.sources) : ''}`);
console.log(`\nflags on D3 (own resubmission of Y): ${psql(`SELECT count(*) FROM fraud_flags WHERE application_id='${state.P.D3.applicationId}';`)}`);
