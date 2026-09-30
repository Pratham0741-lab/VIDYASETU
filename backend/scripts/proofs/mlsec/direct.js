// Runs INSIDE the api container: POSTs to the real ml service over the internal network.
const b64 = require('fs').readFileSync(0).toString('base64');
const post = (p, body) => fetch('http://ml:8000/v1/documents/' + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
(async () => {
  const q = await post('quality', { image_base64: b64 });
  const c = await post('classify', { image_base64: b64 });
  const e = await post('extract', { image_base64: b64, document_type: 'INCOME_CERTIFICATE' });
  console.log(`  /quality  HTTP ${q.status} usable=${q.body.value.usable} issues=${JSON.stringify(q.body.value.issues)} blur=${q.body.details.blur_score}`);
  console.log(`  /classify HTTP ${c.status} value=${c.body.value} confidence=${c.body.confidence}`);
  console.log(`  /extract  HTTP ${e.status} raw_text=${JSON.stringify(e.body.raw_text)}`);
  for (const [k, v] of Object.entries(e.body.value)) console.log(`     ${k.padEnd(22)} value=${JSON.stringify(v).padEnd(24)} confidence=${e.body.confidence[k]}`);
})();
