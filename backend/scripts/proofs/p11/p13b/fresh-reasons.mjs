// Phase 13B proof 5 (log window): fresh reason-bearing writes after the last api restart.
import { call, login, state } from '../lib.mjs';
import { applicant } from '../setup.mjs';
const ino = await login('ino.ranchi.p11@example.org');
const A = (k) => state.P[k].applicationId;
for (const [k, f, l, d] of [['LK1', 'Fulmani', 'Ekka', '2004-07-01'], ['LK2', 'Gopal', 'Lakra', '2004-07-02'], ['LK3', 'Hemlata', 'Bara', '2004-07-03']]) {
  await applicant([k, f, l, d, k === 'LK2' ? 'MALE' : 'FEMALE', 'Ranchi', `SBIN0004455:7070${k.slice(-1)}0070`, `JH-ST-2026-70${k.slice(-1)}070`, null]);
}
const R = 'Photograph page missing - LEAKCHECK-8R5W, noted by Shri Balram Toppo, ph 9876501234.';
const b = await call('POST', '/applications/bulk-actions', { action: 'MARK_DEFECTIVE', application_ids: [A('LK1'), A('LK2')], reason: R, deficiency: { code: 'DEF_PHOTO_MISSING', title: 'Photograph missing', description: 'Upload a recent photograph.' } }, ino, { raw: true });
console.log(`bulk MARK_DEFECTIVE: HTTP ${b.status} changed=${b.body.changed} skipped=${b.body.skipped}`);
const r = await call('POST', `/applications/${A('LK3')}/reject`, { remarks: 'Rejected: ' + R }, ino, { raw: true });
console.log(`reject: HTTP ${r.status} ${r.body.current_stage ?? r.body.code ?? ''}`);
