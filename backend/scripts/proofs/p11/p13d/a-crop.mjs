// Phase 13D proof 2 (ML_MODE=real): an expired-certificate deficiency carries a crop_ref,
// and the crop route serves only that region, only to permitted viewers.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { call, login, save, state, waitProcessed, PW, VERSIONS as V, LEVELS as LVL } from '../lib.mjs';
import { psql } from '../psql.mjs';

const API = 'http://localhost:3000/api/v1';
const docs = JSON.parse(readFileSync('p13d/docs.json', 'utf8'));
const pngSize = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];
export async function uploadFile(token, appId, slot, path) {
  const fd = new FormData();
  fd.append('document_type', slot);
  fd.append('file', new Blob([readFileSync(path)], { type: 'image/png' }), 'income-certificate.png');
  return call('POST', `/applications/${appId}/documents`, fd, token, { raw: true });
}
export async function realApplicant(key, first, last) {
  state.P ??= {};
  if (state.P[key]) return state.P[key];
  const email = `${key.toLowerCase()}.${first.toLowerCase()}.p11@example.org`;
  const n = String(Object.keys(state.P).length + 200);
  const reg = await call('POST', '/auth/register', { email, password: PW, first_name: first, last_name: last, category: 'ST', domicile_state: 'Jharkhand', domicile_district: 'Ranchi', caste_cert_number: `JH-ST-2026-13D${n}`, annual_income: '180000.00', bank_account: `SBIN0004455:13D0${n}0`, gender: 'MALE', dob: '2003-05-05' }, undefined, { raw: true });
  if (reg.status !== 201) throw new Error(`register ${key}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const app = await call('POST', '/applications', { scheme_version_id: V.POST_MATRIC, academic_year: '2026-27', declared: { education_level: LVL.POST_MATRIC } }, await login(email));
  state.P[key] = { email, applicationId: app.id, application_no: app.application_no };
  save();
  return state.P[key];
}

if (process.argv[1]?.endsWith('a-crop.mjs')) {
  const SLOT = 'Family Income Certificate';
  const CR1 = await realApplicant(process.env.KEY ?? 'CR2', 'Mangal', 'Oraon');
  const ta = await login(CR1.email);
  console.log(`CR1 ${CR1.application_no} (Ranchi); ml engine: ${psql(`SELECT 1`) && 'real (ML_MODE=real)'}`);
  let r = await uploadFile(ta, CR1.applicationId, SLOT, 'p13d/expired.png');
  console.log(`upload rendered income certificate (issued 01/06/2024, page ${docs.expired.size.join('x')}): HTTP ${r.status} ${r.body.status}`);
  const d = await waitProcessed(ta, r.body.document_id);
  CR1.docId = r.body.document_id; save();
  console.log('extraction (DB): ' + psql(`SELECT 'engine='||extraction_engine||' issued_date='||(extracted_data->>'issued_date')||' box='||coalesce((field_boxes->'issued_date')::text,'null') FROM document_extractions WHERE document_id='${CR1.docId}';`));
  console.log(`true region of the date on the page: ${JSON.stringify(docs.expired.date_region)}`);

  const ino = await login('ino.ranchi.p11@example.org');
  r = await call('POST', `/applications/${CR1.applicationId}/deficiencies`, { reason: 'Income certificate issued 01/06/2024 is past the 12-month validity.', include_failed_checks: false, items: [{ document_slot: SLOT, check_code: 'DOCUMENT_VALIDITY' }] }, ino, { raw: true });
  writeFileSync('responses/p13d/a-issue-CR1.json', JSON.stringify(r, null, 1));
  const item = r.body.items?.[0];
  CR1.deficiencyId = r.body.deficiency_id; CR1.itemId = item?.id; save();
  console.log(`issue: HTTP ${r.status} stage=${r.body.current_stage} item problem=${item?.problem_code} crop_ref=${JSON.stringify(item?.crop_ref)}`);

  const url = `/applications/${CR1.applicationId}/deficiencies/items/${CR1.itemId}/crop`;
  const get = async (token) => {
    const res = await fetch(API + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), buf };
  };
  console.log('\ncrop route ' + url.replace(CR1.applicationId, ':id').replace(CR1.itemId, ':itemId'));
  for (const [label, email] of [['CR1 (owner)', CR1.email], ['INO Ranchi', 'ino.ranchi.p11@example.org'], ['DNO Ranchi', 'dno.ranchi.p11@example.org'], ['INO Dumka', 'ino.dumka.p11@example.org'], ['DNO Dumka', 'dno.dumka.p11@example.org'], ['another applicant (H1)', state.P.H1.email], ['AUDITOR Jharkhand', 'auditor.jharkhand.p11@example.org'], ['no token', null]]) {
    const g = await get(email ? await login(email) : null);
    let extra = '';
    if (g.status === 200) {
      const [w, h] = pngSize(g.buf);
      writeFileSync(`responses/p13d/crop-${label.replace(/\W+/g, '-')}.png`, g.buf);
      extra = ` ${g.type} cache-control=${g.cache} crop ${w}x${h} px = ${((100 * w * h) / (docs.expired.size[0] * docs.expired.size[1])).toFixed(1)}% of the page`;
    } else extra = ` ${JSON.parse(g.buf.toString()).code}`;
    console.log(`  ${label.padEnd(24)} HTTP ${g.status}${extra}`);
  }

  await new Promise((res) => setTimeout(res, 4000));
  console.log('\nnotice (in-app) for CR1:\n  ' + psql(`SELECT body FROM notifications WHERE application_id='${CR1.applicationId}' AND template_key='DEFICIENCY_NOTICE' AND channel='IN_APP' ORDER BY created_at DESC LIMIT 1;`).split('\n').join('\n  '));

  console.log('\nas app_user (RLS): the item and its crop_ref');
  for (const [label, email, role] of [['CR1', CR1.email, 'APPLICANT'], ['INO Ranchi', 'ino.ranchi.p11@example.org', 'INSTITUTE_NODAL_OFFICER'], ['INO Dumka', 'ino.dumka.p11@example.org', 'INSTITUTE_NODAL_OFFICER'], ['H1 (another applicant)', state.P.H1.email, 'APPLICANT'], ['no actor set', null, null]]) {
    const set = email ? `SELECT 'x' FROM (SELECT set_config('app.actor_id', (SELECT id::text FROM accounts WHERE email='${email}'), true), set_config('app.actor_role', '${role}', true)) s;` : '';
    const out = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu', input: `SET ROLE app_user; BEGIN; SET TRANSACTION READ ONLY; ${set} SELECT count(*)||' row(s), crop_ref present: '||count(*) FILTER (WHERE crop_ref IS NOT NULL) FROM deficiency_items WHERE id='${CR1.itemId}'; COMMIT;` });
    console.log(`  ${label.padEnd(24)} ${(out.stderr.toString().trim().split('\n')[0] || out.stdout.toString().trim().split('\n').pop())}`);
  }
}
