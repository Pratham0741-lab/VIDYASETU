// Phase 17 D: the SYSTEM-actor paths that read applicants still work under RLS - the document
// pipeline (eligibility cross-check) and the fraud data layer - and nothing refused them.
import { call, login, state, upload, waitProcessed, PW } from '../lib.mjs';
import { psql } from '../psql.mjs';
const line = (label, r, extra = '') => console.log(`${label.padEnd(66)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const app = state.P17.PV1.applicationId;
const t1 = await login(state.P17.PV1.email);
console.log('PV1 application stage: ' + psql(`SELECT current_stage FROM applications WHERE id='${app}';`));
const denBefore = psql(`SELECT count(*) FROM authorization_denials WHERE denial_reason='SYSTEM_ACTOR_GUARD_FAILED';`);
let r = await upload(t1, app, 'Fee Receipt', 'p17-d-system-path');
line('PV1 uploads a fee receipt', r, ` doc=${r.body?.document_id ?? r.body?.id ?? JSON.stringify(r.body)}`);
const docId = r.body?.document_id ?? r.body?.id; if (docId) {
  const d = await waitProcessed(t1, docId);
  console.log(`  pipeline finished: state=${d.state} extraction=${d.extraction?.status ?? d.extraction_status ?? '-'}`);
  console.log('  eligibility cross-check rows for it: ' + psql(`SELECT count(*) FROM document_extractions WHERE document_id='${docId}';`));
}
const ino = await login('ino.ranchi.p11@example.org');
r = await call('POST', `/applications/${app}/fraud-checks`, undefined, ino, { raw: true });
line('INO Ranchi runs the fraud checks on PV1 (SYSTEM fraud data layer)', r, ` ${JSON.stringify(r.body).slice(0, 160)}`);
console.log(`SYSTEM_ACTOR_GUARD_FAILED denials before=${denBefore} after=${psql(`SELECT count(*) FROM authorization_denials WHERE denial_reason='SYSTEM_ACTOR_GUARD_FAILED';`)}`);
