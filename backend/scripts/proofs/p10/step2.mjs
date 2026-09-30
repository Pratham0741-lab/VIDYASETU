import { call, login, save, state, uploadFile, uploadDigiLocker, waitProcessed } from './lib.mjs';
import { execFileSync } from 'node:child_process';
const mlCalls = () => execFileSync('docker', ['compose', 'logs', 'ml', '--no-log-prefix'], { cwd: 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu' })
  .toString().split('\n').filter((l) => /POST \/v1\/documents\//.test(l));
const count = () => mlCalls().length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await login(state.P.K.email), app = state.P.K.applicationId;
const c0 = count();
console.log(`ml service POST /v1/documents/* requests at start: ${c0}`);

console.log('\n--- CONTROL: a normal file upload (OCR pipeline)');
const u = await uploadFile(t, app, 'marksheet', 'D:/PROJECTS/SIH_FELLOWSHIP/.mlcal/set/docs/marks_1.png');
console.log(`HTTP ${u.status} status=${u.body.status} ml_mode=${u.body.ml_mode}`);
const ud = await waitProcessed(t, u.body.document_id);
await sleep(2000);
const c1 = count();
console.log(`  -> ${ud.state}, engine=${ud.extraction?.engine}; ml requests now ${c1} (+${c1 - c0}):`);
for (const l of mlCalls().slice(c0)) console.log('     ' + (l.match(/"(POST [^"]+)" (\d+)/)?.slice(1).join(' -> ') ?? l));

console.log('\n--- DIGILOCKER: same applicant, reference instead of a file');
const d = await uploadDigiLocker(t, app, 'Family Income Certificate', 'in.gov.jharkhand.edistrict-INCER-JH2026000451');
console.log(`HTTP ${d.status} ${JSON.stringify(d.body, null, 1)}`);
state.dlDoc = d.body.document_id; save();
await sleep(8000); // the enqueued job's first attempt is delayed 1.5 s
const c2 = count();
console.log(`\nml requests after the DigiLocker upload (+8 s for its pipeline job): ${c2} (+${c2 - c1})`);

console.log('\n--- GET /documents/:id (as the INO officer)');
const g = await call('GET', `/documents/${d.body.document_id}`, undefined, await login('ino.ranchi.p10@example.org'));
console.log(JSON.stringify({ state: g.state, source: g.source, digilocker: g.digilocker, quality: g.quality, file_name: g.file_name, mime_type: g.mime_type,
  extraction: { engine: g.extraction.engine, classification: g.extraction.classification, review_status: g.extraction.review_status,
  fields: g.extraction.fields.map((f) => `${f.name}=${JSON.stringify(f.value)} conf=${f.confidence} ${f.review}${f.sensitive ? ' (sensitive)' : ''}`),
  eligibility_mismatches: g.extraction.eligibility_mismatches } }, null, 1));
console.log('\n--- the OCR-uploaded marksheet, for contrast:', JSON.stringify({ source: ud.source, digilocker: ud.digilocker, engine: ud.extraction?.engine, quality_usable: ud.quality?.usable }));
