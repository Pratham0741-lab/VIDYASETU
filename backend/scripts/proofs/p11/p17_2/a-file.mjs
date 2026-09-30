// Phase 17.2 Part A: GET /documents/:id/file - bytes for the owner and in-jurisdiction reviewers
// (SHA-256 compared with the stored hash; only the match is printed), 404 outside scope (recorded
// as a denial), 403 for AUDITOR / COMMITTEE / SUPER_ADMIN, 401 without a token, 415 for a type
// that is not served, one document_access_log row per success. Headers shown.
import { createHash } from 'node:crypto';
import { API, login, psql } from './h.mjs';

const PNG_DOC = '2be5e2e8-e0fb-4562-9bee-09a38f630f5b'; // PV1 (Ranchi) fee receipt, image/png
const PDF_DOC = '3cbb0cd1-b6f3-4f0b-bbff-df9c88dc7d06'; // pd1 (Ranchi) Phase 13E fixture, application/pdf
const stored = (id) => psql(`SELECT file_sha256 FROM documents WHERE id='${id}';`);
const logRows = () => Number(psql(`SELECT count(*) FROM document_access_log WHERE resource_type='document_file';`));
const denials = () => Number(psql(`SELECT count(*) FROM authorization_denials;`));

async function fetchFile(label, id, email) {
  const token = email ? await login(email) : null;
  const before = logRows();
  const res = await fetch(`${API}/documents/${id}/file`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const buf = Buffer.from(await res.arrayBuffer());
  const after = logRows();
  let extra = '';
  if (res.status === 200) {
    const match = createHash('sha256').update(buf).digest('hex') === stored(id);
    extra = ` ${res.headers.get('content-type')} sha256 matches stored: ${match}; access rows +${after - before}`;
  } else {
    let code = '';
    try { code = JSON.parse(buf.toString()).code; } catch { /* not JSON */ }
    extra = ` ${code}; access rows +${after - before}`;
  }
  console.log(`${label.padEnd(58)} HTTP ${res.status}${extra}`);
  return res;
}

console.log('=== successes (owner, reviewers in jurisdiction)');
const r = await fetchFile('PV1 (owner) PNG', PNG_DOC, 'pv1.rinki.p11@example.org');
console.log('    headers:', ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options', 'content-security-policy', 'content-length', 'transfer-encoding'].map((h) => `${h}=${r.headers.get(h)}`).join(' | '));
await fetchFile('INO Ranchi (in jurisdiction) PNG', PNG_DOC, 'ino.ranchi.p11@example.org');
await fetchFile('DNO Ranchi PNG', PNG_DOC, 'dno.ranchi.p11@example.org');
await fetchFile('SNO Jharkhand PNG', PNG_DOC, 'sno.jharkhand.p11@example.org');
await fetchFile('MINISTRY PNG', PNG_DOC, 'ministry.p11@example.org');
await fetchFile('pd1 (owner) PDF', PDF_DOC, 'pd1.karma.p11@example.org');

console.log('\n=== refusals');
const d0 = denials();
await fetchFile('PV2 (another applicant)', PNG_DOC, 'pv2.mary.p11@example.org');
await fetchFile('INO Dumka (other district)', PNG_DOC, 'ino.dumka.p11@example.org');
await fetchFile('INO Ranchi, nonexistent id', '00000000-0000-4000-8000-000000017020', 'ino.ranchi.p11@example.org');
await fetchFile('AUDITOR', PNG_DOC, 'auditor.jharkhand.p11@example.org');
await fetchFile('COMMITTEE', PNG_DOC, 'committee.ranchi.p11@example.org');
await fetchFile('SUPER_ADMIN', PNG_DOC, 'admin.p11@example.org');
await fetchFile('no token', PNG_DOC, null);
console.log(`    denials recorded for these: ${denials() - d0}`);
console.log(psql(`SELECT '    '||denial_reason||' | '||action_attempted||' | '||coalesce(actor_role,'-') FROM authorization_denials ORDER BY occurred_at DESC LIMIT ${denials() - d0};`));

console.log('\n=== 415: a tagged fixture document whose stored type is text/html');
const fx = psql(`
  INSERT INTO documents (application_id, document_type, file_name, mime_type, file_size_bytes, file_sha256, file_path, source, intake_status, quality_usable)
  SELECT application_id, document_type, 'p17_2-fixture.html', 'text/html', file_size_bytes, file_sha256, file_path, 'UPLOAD', intake_status, quality_usable
    FROM documents WHERE id='${PNG_DOC}' RETURNING id;`).split('\n')[0];
psql(`INSERT INTO test_fixtures (entity_type, entity_id, label, note) VALUES ('document', '${fx}', 'p17_2-fixture', 'Phase 17.2 Part A 415 proof: a stored type the file route refuses');`);
const r415 = await fetchFile('PV1 (owner), text/html document', fx, 'pv1.rinki.p11@example.org');
console.log('    body:', JSON.stringify(await (await fetch(`${API}/documents/${fx}/file`, { headers: { Authorization: `Bearer ${await login('pv1.rinki.p11@example.org')}` } })).json()));
void r415;

console.log('\n=== access log rows written by this proof (resource_type document_file)');
console.log(psql(`SELECT '    '||l.access_kind||' '||l.resource_type||' doc='||left(l.document_id::text,8)||' '||l.route||' by '||a.email||' ('||l.actor_role||')' FROM document_access_log l JOIN accounts a ON a.id=l.actor_account_id WHERE l.resource_type='document_file' ORDER BY l.accessed_at;`));
