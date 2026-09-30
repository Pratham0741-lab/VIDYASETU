import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { call, login, save, state } from './p9lib.mjs';

const API = 'http://127.0.0.1:3000/api/v1';
const min = await login('ministry9@example.org');

// Independent canonical JSON + SHA-256 (written here, not imported from the api).
const canon = (v) =>
  v === null || typeof v !== 'object'
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? `[${v.map(canon).join(',')}]`
      : `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
const sha = (v) => createHash('sha256').update(canon(v), 'utf8').digest('hex');

console.log('=== confirm K (TOP_CLASS; objection window open -> override with reason)');
const ck = await call('POST', `/selections/${state.P.K.selectionId}/confirm`, { override_reason: 'Single-candidate NO_COMPETITION run; committee approved immediate confirmation on 27-09-2026.' }, min);
console.log(`K: ${ck.selection.selection_status} overridden=${ck.selection.objection_window_overridden}`);

for (const key of ['K', 'T4']) {
  const r = await call('POST', `/selections/${state.P[key].selectionId}/sanction-order`, undefined, min, { raw: true });
  console.log(`\n=== STEP 3: sanction order for ${key} (${state.P[key].scheme}): HTTP ${r.status}`);
  const o = r.body;
  state.P[key].sanctionOrderId = o.sanction_order_id; save();
  console.log(`  sanction_order_id=${o.sanction_order_id}\n  stored content_sha256=${o.content_sha256}\n  qr_payload=${o.qr_payload}\n  pdf: ${o.pdf_bytes} bytes at ${o.pdf_storage_key}`);
  console.log(`  annual_entitlement=${JSON.stringify(o.content.annual_entitlement)}`);
  console.log(`  unschedulable_benefits=${JSON.stringify(o.content.unschedulable_benefits)}`);

  // Independent recompute from the STORED data (GET), then the API's own verify, then a tampered copy.
  const stored = await call('GET', `/sanction-orders/${o.sanction_order_id}`, undefined, min);
  const mine = sha(stored.content);
  console.log(`  independent recompute over GET /sanction-orders/:id content: ${mine}\n  matches stored hash: ${mine === stored.content_sha256}`);
  const v = await call('POST', '/sanction-orders/verify', { content: stored.content }, min);
  console.log(`  POST /sanction-orders/verify (as issued): match=${v.match}`);
  const tampered = { ...stored.content, applicant_name: stored.content.applicant_name + ' X' };
  const vt = await call('POST', '/sanction-orders/verify', { content: tampered }, min);
  console.log(`  POST /sanction-orders/verify (applicant_name altered): match=${vt.match} recomputed=${vt.recomputed_sha256.slice(0, 16)}...`);

  if (key === 'K') {
    const res = await fetch(`${API}/sanction-orders/${o.sanction_order_id}/pdf`, { headers: { Authorization: `Bearer ${min}` } });
    const pdf = Buffer.from(await res.arrayBuffer());
    writeFileSync(`sanction-${key}.pdf`, pdf);
    console.log(`  GET .../pdf: HTTP ${res.status} ${res.headers.get('content-type')} ${pdf.length} bytes, header ${JSON.stringify(pdf.subarray(0, 8).toString('latin1'))}, images=${(pdf.toString('latin1').match(/\/Subtype \/Image/g) || []).length}`);
    // Extract the visible text: inflate every FlateDecode stream, decode the hex strings in TJ arrays.
    const raw = pdf.toString('latin1');
    const lines = [];
    for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
      let body;
      try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
      for (const t of body.matchAll(/\[([^\]]*)\] TJ/g)) {
        const text = [...t[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('');
        if (text.trim()) lines.push(text);
      }
    }
    console.log('  --- PDF text (extracted from the real file) ---');
    for (const l of lines) console.log(`  | ${l}`);
  }
}
