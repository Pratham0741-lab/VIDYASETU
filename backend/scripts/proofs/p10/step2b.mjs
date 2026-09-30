import { call, login, save, state, uploadDigiLocker } from './lib.mjs';
import { psql } from './psql.mjs';
const D = state.dlDoc;
console.log('--- stored rows for the DigiLocker document');
console.log(psql(`SELECT d.source, d.intake_status, d.quality_usable, d.issuer_document_date, d.mime_type, e.extraction_engine, e.review_status, e.extracted_data->'family_income_annual' AS income_as_stored, length(e.sensitive_values) AS enc_bytes FROM documents d JOIN document_extractions e ON e.document_id=d.id WHERE d.id='${D}';`, []));
console.log(psql(`SELECT table_name, action, coalesce(actor_type,'-') AS actor_type, actor_role FROM audit_logs WHERE record_id IN ('${D}', (SELECT id FROM document_extractions WHERE document_id='${D}')) ORDER BY created_at, table_name;`, []));
console.log('worker log lines for this document:');
console.log(psql(`SELECT 1;`) && require_logs(D));
function require_logs(id) {
  const { execFileSync } = await_import();
  return execFileSync('docker', ['compose', 'logs', 'api', '--no-log-prefix'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' }).toString().split('\n').filter((l) => l.includes(id)).map((l) => { try { const j = JSON.parse(l); return `  ${j.level} ${j.msg}`; } catch { return '  ' + l.slice(0, 160); } }).join('\n') || '  (none: no failed attempts)';
}
function await_import() { return globalThis.__cp; }
