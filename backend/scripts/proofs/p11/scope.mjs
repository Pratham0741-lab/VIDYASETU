import { writeFileSync } from 'node:fs';
import { call, login, state } from './lib.mjs';
import { psql } from './psql.mjs';
let seq = 10;
const rec = (label, r) => { writeFileSync(`responses/${String(++seq).padStart(2, '0')}-${label}.json`, JSON.stringify(r, null, 1)); return r; };
const req = async (label, m, p, b, t) => rec(label, await call(m, p, b, t, { raw: true }));
const P = state.P, A = (k) => P[k].applicationId;
const key = Object.fromEntries(Object.entries(P).map(([k, p]) => [p.application_no, k]));
const line = (s, r, extra = '') => console.log(`${s.padEnd(62)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const tok = {}; for (const w of ['ino.ranchi', 'dno.ranchi', 'ino.dumka', 'dno.dumka', 'sno.jharkhand']) tok[w] = await login(`${w}.p11@example.org`);

console.log('=== Reject / mark-defective stay allowed on a HIGH-held application (C2) ===');
let r = await req('c2-defective', 'POST', `/applications/${A('C2')}/mark-defective`, { code: 'DEF_DUPLICATE_CERT', title: 'Certificate number needs checking', description: 'Upload the original caste certificate.' }, tok['ino.ranchi']);
line('Ranchi INO marks C2 defective (its HIGH flag is OPEN)', r, ` stage=${r.body.application?.current_stage ?? ''}`);

console.log('\n=== Queue ?fraud=HIGH ===');
for (const w of ['ino.ranchi', 'ino.dumka']) {
  r = await req(`queue-${w}`, 'GET', '/applications/queue?fraud=HIGH', undefined, tok[w]);
  console.log(`${w}: HTTP ${r.status} count=${r.body.count} ->`, JSON.stringify(r.body.applications.map((i) => `${key[i.application_no] ?? i.application_no}:${i.fraud.held ? 'HELD' : 'advisory'}(${i.fraud.flags.map((f) => f.flag_type + '/' + f.severity + '/' + f.status).join(',')})`)));
}
r = await req('queue-ino.ranchi-all', 'GET', '/applications/queue', undefined, tok['ino.ranchi']);
console.log(`ino.ranchi, no filter: count=${r.body.count}; F2 row fraud=${JSON.stringify(r.body.applications.find((i) => i.id === A('F2'))?.fraud)}`);

console.log('\n=== Proof 6: flag visibility by jurisdiction (API) ===');
for (const [w, k] of [['ino.ranchi', 'B1'], ['ino.ranchi', 'B2'], ['dno.ranchi', 'B2'], ['ino.dumka', 'B2'], ['ino.dumka', 'B1'], ['dno.dumka', 'B2'], ['dno.dumka', 'B1'], ['sno.jharkhand', 'B2']]) {
  r = await req(`flags-${w}-${k}`, 'GET', `/applications/${A(k)}/fraud-flags`, undefined, tok[w]);
  line(`${w} GET ${k} (${P[k].district}) fraud-flags`, r, r.status === 200 ? ` flags=${JSON.stringify(r.body.flags.map((f) => f.flag_type + '/' + f.status))} held=${r.body.held}` : '');
}
const b2Flag = psql(`SELECT id FROM fraud_flags WHERE application_id='${A('B2')}' AND flag_type='SHARED_BANK_ACCOUNT';`);
r = await req('disp-oos', 'POST', `/fraud-flags/${b2Flag}/disposition`, { status: 'FALSE_POSITIVE', notes: 'out-of-jurisdiction attempt' }, tok['ino.ranchi']);
line('ino.ranchi dispositions B2 flag (Dumka) FALSE_POSITIVE', r);
r = await req('checks-oos', 'POST', `/applications/${A('B2')}/fraud-checks`, undefined, tok['ino.ranchi']);
line('ino.ranchi runs fraud-checks on B2 (Dumka)', r);
console.log('  B2 flag status after the attempts:', psql(`SELECT status FROM fraud_flags WHERE id='${b2Flag}';`));
r = await req('b2-verify-dumka', 'POST', `/applications/${A('B2')}/verify`, { remarks: 'verify B2' }, tok['ino.dumka']);
line('ino.dumka verifies B2 (its own HIGH flag OPEN)', r);

console.log('\n=== Proof 6: RLS alone, as app_user (no API) ===');
const uid = (e) => psql(`SELECT id FROM accounts WHERE email='${e}';`);
for (const w of ['ino.ranchi', 'ino.dumka', 'dno.dumka', 'sno.jharkhand']) {
  const out = psql(`SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id','${uid(`${w}.p11@example.org`)}',true), set_config('app.actor_role','OFFICER',true);
    SELECT '${w}: ' || count(*) || ' flags visible; B1 flag visible=' || bool_or(application_id='${A('B1')}')::text || '; B2 flag visible=' || coalesce(bool_or(application_id='${A('B2')}'),false)::text || '; districts=' || string_agg(DISTINCT jurisdiction_district, ',') FROM fraud_flags; COMMIT;`).split('\n').filter((l) => l.includes(':')).join('');
  console.log(' ', out);
}
console.log(' ', psql(`SET ROLE app_user; SELECT 'no actor context: ' || count(*) || ' flags visible' FROM fraud_flags;`).split('\n').at(-1));
console.log(' ', psql(`SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id','${uid('ino.ranchi.p11@example.org')}',true), set_config('app.actor_role','OFFICER',true); UPDATE fraud_flags SET status='FALSE_POSITIVE', reviewed_by_officer_id=(SELECT id FROM officers LIMIT 1), reviewed_at=now() WHERE id='${b2Flag}'; ROLLBACK;`, ['-At', '-v', 'ON_ERROR_STOP=1']).split('\n').filter((l) => /UPDATE/.test(l)).join('') || '(update printed nothing)');
console.log(' ', psql(`SET ROLE app_user; SELECT count(*) FROM pii_match_index;`).split('\n').at(-1), '<- pii_match_index rows visible to app_user with no SYSTEM context');
