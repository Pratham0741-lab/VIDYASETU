// Phase 17.2 Part A (continued): a stored type the route does not serve -> 415 with the message key,
// no access row, the object never opened. Uses one tagged fixture document row (label p17_2-fixture).
import { API, login, psql } from './h.mjs';

const PNG_DOC = '2be5e2e8-e0fb-4562-9bee-09a38f630f5b';
const logRows = () => Number(psql(`SELECT count(*) FROM document_access_log WHERE resource_type='document_file';`));
let fx = psql(`SELECT f.entity_id FROM test_fixtures f WHERE f.label='p17_2-fixture' AND f.entity_type='document' LIMIT 1;`);
if (!fx) {
  fx = psql(`INSERT INTO documents (application_id, document_type, file_name, mime_type, file_size_bytes, file_sha256, file_path, source, intake_status, quality_usable, updated_at)
    SELECT application_id, document_type, 'p17_2-fixture.html', 'text/html', file_size_bytes, file_sha256, file_path, 'UPLOAD', intake_status, quality_usable, now()
      FROM documents WHERE id='${PNG_DOC}' RETURNING id;`).split('\n')[0];
  psql(`INSERT INTO test_fixtures (entity_type, entity_id, label, note) VALUES ('document', '${fx}', 'p17_2-fixture', 'Phase 17.2 Part A 415 proof: a stored type the file route refuses');`);
}
console.log(`fixture document ${fx}: ${psql(`SELECT mime_type||', tagged='||EXISTS(SELECT 1 FROM test_fixtures WHERE entity_id='${fx}') FROM documents WHERE id='${fx}';`)}`);
const before = logRows();
const res = await fetch(`${API}/documents/${fx}/file`, { headers: { Authorization: `Bearer ${await login('pv1.rinki.p11@example.org')}` } });
const body = await res.json();
console.log(`PV1 (owner) GET /documents/<text/html fixture>/file   HTTP ${res.status} content-type=${res.headers.get('content-type')}; access rows +${logRows() - before}`);
console.log('body:', JSON.stringify(body));
