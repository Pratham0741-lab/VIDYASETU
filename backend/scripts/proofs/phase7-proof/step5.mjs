import { call, enc, login, save, state, upload, waitProcessed } from './p7.mjs';
const key = process.argv[2]; // 'A' or 'B'
const odd = JSON.parse(process.argv[3]); // { slot, name }
const base = process.argv[4];            // holder name on every other document
const extra = process.argv[5] ? JSON.parse(process.argv[5]) : {}; // { slot: extraParams }
const t = await login(state[key].email);
const list = await call('GET', `/applications/${state[key].applicationId}/documents`, undefined, t);
const done = new Set(list.slots.filter((s) => ['AUTO_ACCEPTED', 'NEEDS_REVIEW', 'OFFICER_CONFIRMED'].includes(s.state)).map((s) => s.slot));
console.log(`checklist (${list.checklist.length} slots, Phase 3 derivation); already processed: ${done.size}`);
for (const slot of list.checklist) {
  if (done.has(slot)) continue;
  const name = slot === odd.slot ? odd.name : base;
  const r = await upload(t, state[key].applicationId, slot, `clean;type=${enc(slot)};holder_name=${enc(name)}${extra[slot] ?? ''}`);
  const d = await waitProcessed(t, r.body.document_id);
  console.log(`  ${String(r.status)} ${slot.slice(0, 60).padEnd(60)} holder_name=${JSON.stringify(name).padEnd(15)} -> ${d.state}`);
}
for (let i = 0; i < 30; i++) {
  const l = await call('GET', `/applications/${state[key].applicationId}/documents`, undefined, t);
  if (l.flags.document_consistency_status) { console.log(`\nflags after the last upload (MOCK consistency): ${JSON.stringify(l.flags)}`); break; }
  await new Promise((r) => setTimeout(r, 1000));
}
