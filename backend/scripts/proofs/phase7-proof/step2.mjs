import { login, state, upload } from './p7.mjs';
const t = await login(state.A.email);
const t0 = Date.now();
const r = await upload(t, state.A.applicationId, 'Family Income Certificate', 'quality_fail;type=Family%20Income%20Certificate');
console.log(`HTTP ${r.status} in ${Date.now() - t0} ms (synchronous response)`);
console.log(JSON.stringify(r.body, null, 1));
state.qualityFailDoc = r.body.document_id; (await import('./p7.mjs')).save();
