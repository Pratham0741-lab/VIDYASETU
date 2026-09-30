// Phase 17.2 Parts B-F, live over HTTP. Saves the history / objections responses to responses/
// for the leak search, and writes extra.json: the identities and free text these routes must
// never return (officer ids, emails, names; decision remarks and grievance texts of the rows used).
import { writeFileSync } from 'node:fs';
import { login, psql, req, line } from './h.mjs';

const save = (name, body) => writeFileSync(`responses/${name}.json`, JSON.stringify(body, null, 1));
const HIST_APP = '34db08f7-108c-40a2-9803-5cefe15509ca'; // rs1 (Ranchi): eligibility_passed, mark_defective, resubmit
const LIST = '8992147d-eb3c-48af-980e-34ca8a87e7f7'; // NFST 2032-33, two objections (Ranchi)
const RESULT_APP = '8c7cb46c-e6d0-4de6-acb4-f10dd4e8773f'; // sm1 on that list

console.log('=== B  GET /applications/:id/history');
for (const [who, email] of [['rs1 (owner)', 'rs1.mangal.p11@example.org'], ['INO Ranchi', 'ino.ranchi.p11@example.org'], ['SNO', 'sno.jharkhand.p11@example.org'], ['MINISTRY', 'ministry.p11@example.org']]) {
  const r = await req('GET', `/applications/${HIST_APP}/history`, { token: await login(email) });
  line(who, r, ` entries=${r.body?.history?.length} keys=${[...new Set((r.body?.history ?? []).flatMap((h) => Object.keys(h)))].join(',')}`);
  save(`b-history-${who.split(' ')[0].toLowerCase()}`, r.body);
}
console.log('    ' + JSON.stringify((await req('GET', `/applications/${HIST_APP}/history`, { token: await login('rs1.mangal.p11@example.org') })).body.history));
for (const [who, email] of [['PV2 (another applicant)', 'pv2.mary.p11@example.org'], ['INO Dumka (other district)', 'ino.dumka.p11@example.org'], ['AUDITOR', 'auditor.jharkhand.p11@example.org'], ['COMMITTEE', 'committee.ranchi.p11@example.org'], ['SUPER_ADMIN', 'admin.p11@example.org']]) {
  line(who, await req('GET', `/applications/${HIST_APP}/history`, { token: await login(email) }));
}
line('no token', await req('GET', `/applications/${HIST_APP}/history`));

console.log('\n=== C  GET /applications/:id/selection-result: list.selection_run_id');
const c = await req('GET', `/applications/${RESULT_APP}/selection-result`, { token: await login('sm1.birsa.p11@example.org') });
line('sm1 (owner)', c, ` list=${JSON.stringify(c.body?.list)}`);
console.log(`    matches the list's run: ${c.body?.list?.selection_run_id === psql(`SELECT selection_run_id FROM selection_lists WHERE id='${LIST}';`)}`);

console.log('\n=== D  GET /selection-lists/:id/objections');
for (const [who, email] of [['COMMITTEE Ranchi', 'committee.ranchi.p11@example.org'], ['COMMITTEE Dumka', 'committee.dumka.p11@example.org'], ['INO Ranchi', 'ino.ranchi.p11@example.org'], ['INO Dumka', 'ino.dumka.p11@example.org'], ['AUDITOR', 'auditor.jharkhand.p11@example.org']]) {
  const r = await req('GET', `/selection-lists/${LIST}/objections`, { token: await login(email) });
  line(who, r, ` objections=${r.body?.objections?.length}${r.body?.objections?.length ? ' ' + JSON.stringify(r.body.objections) : ''}`);
  save(`d-objections-${who.replace(/ /g, '-').toLowerCase()}`, r.body);
}
for (const [who, email] of [['APPLICANT sm1', 'sm1.birsa.p11@example.org'], ['SUPER_ADMIN', 'admin.p11@example.org']]) {
  line(who, await req('GET', `/selection-lists/${LIST}/objections`, { token: await login(email) }));
}
line('no token', await req('GET', `/selection-lists/${LIST}/objections`));
line('COMMITTEE Ranchi, unknown list', await req('GET', `/selection-lists/00000000-0000-4000-8000-000000017022/objections`, { token: await login('committee.ranchi.p11@example.org') }));

console.log('\n=== E  GET /auth/me');
for (const [who, email] of [['INO Ranchi', 'ino.ranchi.p11@example.org'], ['SNO', 'sno.jharkhand.p11@example.org'], ['AUDITOR', 'auditor.jharkhand.p11@example.org'], ['APPLICANT rs1', 'rs1.mangal.p11@example.org']]) {
  const r = await req('GET', '/auth/me', { token: await login(email) });
  line(who, r, ` keys=${Object.keys(r.body ?? {}).join(',')} name=${r.body?.name ?? '(absent)'} institution_code=${r.body?.institution_code === undefined ? '(absent)' : r.body.institution_code}`);
}

console.log('\n=== F  GET /schemes (public)');
let r = await req('GET', '/schemes');
line('no token', r, ` ${r.body?.schemes?.map((s) => `${s.scheme_code} v${s.version_no} ${s.effective_from}..${s.effective_to ?? ''}`).join('; ')}`);
console.log(`    fields: ${Object.keys(r.body?.schemes?.[0] ?? {}).join(',')}`);
const counts = {};
for (let i = 0; i < 62; i++) {
  const res = await fetch('http://127.0.0.1:3000/api/v1/schemes');
  await res.arrayBuffer();
  counts[res.status] = (counts[res.status] ?? 0) + 1;
}
console.log(`    62 calls within a minute: ${JSON.stringify(counts)} (limit 60 per client IP per minute; one call above already counted)`);

// Needles for the leak search: what the history / objections routes must never return.
const extra = psql(`
  SELECT DISTINCT v FROM (
    SELECT o.id::text v FROM officers o
    UNION SELECT o.user_id::text FROM officers o
    UNION SELECT a.email FROM officers o JOIN accounts a ON a.id=o.user_id
    UNION SELECT o.name FROM officers o
    UNION SELECT d.remarks FROM decision_records d WHERE d.application_id='${HIST_APP}' AND d.remarks IS NOT NULL
    UNION SELECT t.triggered_by FROM workflow_transitions t WHERE t.application_id='${HIST_APP}' AND t.triggered_by IS NOT NULL
    UNION SELECT g.description FROM grievances g WHERE g.subject_type='SELECTION_OBJECTION'
    UNION SELECT g.resolution_note FROM grievances g WHERE g.subject_type='SELECTION_OBJECTION' AND g.resolution_note IS NOT NULL
  ) x WHERE length(v) >= 6;`).split('\n').filter(Boolean);
writeFileSync('extra.json', JSON.stringify(extra));
console.log(`\nleak-search extra needles written: ${extra.length} (officer ids / account ids / emails / names, remarks, grievance texts)`);
