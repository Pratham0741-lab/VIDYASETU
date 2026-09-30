// Phase 14 loose ends, Part E proof: Aadhaar adapter (mock by default). Each mock outcome
// through the API, the number never stored or logged, real mode refused (run with --real
// against an api started with AADHAAR_MODE=real).
import { writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { call, login, save, state, PW } from '../lib.mjs';
import { psql } from '../psql.mjs';

const saveR = (n, r) => writeFileSync(`responses/p14/e-${n}.json`, JSON.stringify(r, null, 1));
const line = (label, r, extra = '') => console.log(`${label.padEnd(64)} HTTP ${r.status} ${r.body?.code ?? ''}${extra}`);
const brief = (b) => b?.authentication ? ` outcome=${b.authentication.outcome} error_code=${b.authentication.error_code} key=${b.authentication.message_key} masked="${b.authentication.aadhaar_masked}" mode=${b.authentication.adapter_mode}` : ` ${JSON.stringify(b?.details ?? b)}`;

async function applicant(key, first, last) {
  state.P14 ??= {};
  state.P14.aa ??= {};
  if (state.P14.aa[key]) return state.P14.aa[key];
  const email = `${key.toLowerCase()}.${first.split(" ")[0].toLowerCase()}.p11@example.org`;
  const n = String(900 + Object.keys(state.P14.aa).length);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-14E${n}`, annual_income: '120000.00', bank_account: `SBIN0004455:14E0${n}0`, gender: 'MALE', dob: '2003-03-03' }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.body));
  state.P14.aa[key] = { email };
  save();
  return state.P14.aa[key];
}
const auth = async (who, aadhaar_number, consent = true) => call('POST', '/applicants/me/aadhaar-authentication', { aadhaar_number, consent }, await login(who.email), { raw: true });

if (process.argv.includes('--real')) {
  console.log('=== E.5 AADHAAR_MODE=real (not configured): refused, no fallback, nothing stored');
  const A1 = state.P14.aa.AA1;
  const before = psql('SELECT count(*) FROM aadhaar_authentications;');
  const r = await auth(A1, '0999 0000 0017');
  line('POST /applicants/me/aadhaar-authentication', r, ` ${JSON.stringify(r.body.details)} message="${r.body.message}"`);
  saveR('real-mode', r);
  console.log(`   rows before/after: ${before}/${psql('SELECT count(*) FROM aadhaar_authentications;')}`);
  console.log('   api log line: ' + execFileSync('docker', ['compose', 'logs', '--no-color', '--since', '2m', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().split('\n').filter((l) => l.includes('aadhaar unavailable')).slice(-1)[0]?.replace(/^.*?\{/, '{').replace(/"time":"[^"]*",/, '') ?? '(none)');
  process.exit(0);
}

console.log('=== E.1 mock outcomes through the API (synthetic numbers only)');
const A1 = await applicant('AA1', 'Test Holder', 'One'); // the synthetic holder's name
const A2 = await applicant('AA2', 'Birsa', 'Hembrom');   // a different name
let r = await auth(A1, '0999 0000 0017');
line('AA1 (name matches the synthetic record) 0999 0000 0017', r, brief(r.body));
saveR('success', r);
r = await auth(A2, '0999-0000-0017');
line('AA2 (different name), same number with dashes', r, brief(r.body));
saveR('mismatch', r);
r = await auth(A2, '0999 0000 0040');
line('AA2 0999 0000 0040 (not available)', r, brief(r.body));
saveR('not-available', r);
const before = psql('SELECT count(*) FROM aadhaar_authentications;');
r = await auth(A2, '0999 0000 0038');
line('AA2 0999 0000 0038 (UIDAI does not answer)', r, brief(r.body));
saveR('timeout', r);
console.log(`   rows before/after the timeout: ${before}/${psql('SELECT count(*) FROM aadhaar_authentications;')}`);
r = await auth(A2, '2363 4717 1234');
line('a realistic-looking number (first digit 2-9), bad checksum', r, brief(r.body));
r = await auth(A2, '2363 4717 1232');
line('a realistic-looking number with a valid checksum', r, brief(r.body));
r = await auth(A2, '0999 0000 0017', false);
line('consent false', r, brief(r.body));
r = await call('GET', '/applicants/me/aadhaar-authentication', undefined, await login(A1.email), { raw: true });
line('GET my latest (AA1)', r, brief(r.body));

console.log('\n=== E.2 what is stored (and what is not)');
console.log(psql(`SELECT c.email||' '||x.outcome||' '||coalesce(x.error_code,'-')||' last4='||x.uid_last4||' hmac='||left(x.uid_hmac,16)||'... v'||x.hmac_key_version||' mode='||x.adapter_mode FROM aadhaar_authentications x JOIN applicants p ON p.id=x.applicant_id JOIN accounts c ON c.id=p.user_id ORDER BY x.created_at;`));
console.log('   columns: ' + psql(`SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name='aadhaar_authentications';`));
console.log('   same number, two accounts -> one keyed hash: ' + psql(`SELECT count(DISTINCT uid_hmac)||' distinct hash for '||count(*)||' rows' FROM aadhaar_authentications WHERE uid_last4='0017';`));
const NUMS = ['099900000017', '099900000040', '099900000038', '236347171232'];
const forms = NUMS.flatMap((n) => [n, `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`, `${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8)}`, Buffer.from(n).toString('hex'), Buffer.from(n).toString('base64')]);
const arr = `ARRAY[${forms.map((f) => `'%${f}%'`).join(',')}]`;
for (const t of ['aadhaar_authentications', 'audit_logs', 'authorization_denials', 'notifications', 'applicants']) {
  console.log(`   ${t.padEnd(24)} rows containing a number form: ${psql(`SELECT count(*) FROM ${t} x WHERE row_to_json(x)::text ILIKE ANY(${arr});`)}`);
}
const logs = execFileSync('docker', ['compose', 'logs', '--no-color', 'api'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', maxBuffer: 1 << 29 }).toString();
console.log(`   api logs (${logs.split('\n').length} lines) containing a number form: ${forms.filter((f) => logs.includes(f)).length}; 'MOCK Aadhaar authentication' lines: ${logs.split('\n').filter((l) => l.includes('MOCK Aadhaar authentication')).length}`);
console.log('   a mock log line: ' + logs.split('\n').filter((l) => l.includes('MOCK Aadhaar authentication')).slice(-1)[0].replace(/^.*?\{/, '{').replace(/"time":"[^"]*",/, ''));
console.log('   audit rows: ' + psql(`SELECT count(*)||' rows, actor_role '||string_agg(DISTINCT actor_role, ',') FROM audit_logs WHERE table_name='aadhaar_authentications';`));

console.log('\n=== E.3 scope as app_user');
const as = (email, role) => spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `SET ROLE app_user; BEGIN; SELECT set_config('app.actor_id', ${email ? `(SELECT id::text FROM accounts WHERE email='${email}')` : "''"}, true), set_config('app.actor_role', '${role}', true) \\g /dev/null\nSELECT count(*) FROM aadhaar_authentications; ROLLBACK;` }).stdout.toString().trim();
console.log(`   AA1=${as(A1.email, 'APPLICANT')} AA2=${as(A2.email, 'APPLICANT')} INO Ranchi=${as('ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER')} MINISTRY=${as('ministry.p11@example.org', 'MINISTRY_OFFICER')} AUDITOR=${as('auditor.jharkhand.p11@example.org', 'AUDITOR')} SUPER_ADMIN=${as('admin.p11@example.org', 'SUPER_ADMIN')} no actor=${as(null, '')}`);
for (const who of ['ino.ranchi.p11@example.org', 'auditor.jharkhand.p11@example.org']) {
  r = await call('GET', '/applicants/me/aadhaar-authentication', undefined, await login(who), { raw: true });
  line(`GET /applicants/me/aadhaar-authentication as ${who.split('.p11')[0]}`, r);
}
