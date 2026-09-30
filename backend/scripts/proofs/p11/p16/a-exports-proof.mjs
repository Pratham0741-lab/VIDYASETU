// Phase 16 Part A: XLSX and PDF of every existing view carry exactly the CSV's table (which is
// the JSON's), suppression markers included; the analytics sweep writes nothing; fixtures are
// excluded by default and included only for SUPER_ADMIN.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { call, login } from '../lib.mjs';
import { psql } from '../psql.mjs';

const log = (...a) => console.log(...a);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const parseCsv = (s) => s.trim().split('\r\n').map((l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; });
const xlsxGrid = (buf) => JSON.parse(execFileSync('python', ['-c', `
import zipfile, io, sys, json, re, xml.etree.ElementTree as ET
z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
out = []
for sheet in ('sheet1', 'sheet2'):
    grid = []
    for row in ET.fromstring(z.read('xl/worksheets/%s.xml' % sheet)).find('m:sheetData', ns):
        cells = {}
        for c in row:
            col = re.match(r'[A-Z]+', c.get('r')).group(0); idx = 0
            for ch in col: idx = idx * 26 + (ord(ch) - 64)
            cells[idx - 1] = ''.join(t.text or '' for t in c.iter('{%s}t' % ns['m'])) if c.get('t') == 'inlineStr' else c.find('m:v', ns).text
        grid.append([cells.get(i, '') for i in range((max(cells) + 1) if cells else 0)])
    out.append(grid)
print(json.dumps(out))
`], { input: buf }).toString());
const pdfRuns = (buf) => { const runs = []; const s = buf.toString('latin1'); for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { let c; try { c = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; } for (const bt of c.matchAll(/BT([\s\S]*?)ET/g)) { const hex = [...bt[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]).join(''); if (hex) runs.push(Buffer.from(hex, 'hex').toString('latin1')); } } return runs; };
const trim = (g) => g.map((r) => { const x = [...r]; while (x.length && x[x.length - 1] === '') x.pop(); return x; });

const sa = await login('admin.p11@example.org');
const get = async (path, token = sa) => { const r = await fetch(`http://127.0.0.1:3000/api/v1/analytics/${path}`, { headers: { Authorization: `Bearer ${token}` } }); return { status: r.status, type: r.headers.get('content-type'), disp: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) }; };
const W = 'from=2026-01-01&to=2027-01-01&include_fixtures=true';
const VIEWS = [
  ['funnel', W], ['sla', W], ['schemes', W], ['disbursements', W], ['fraud', W], ['jurisdiction', W],
  ['jurisdiction', `${W}&group_by=institution`], ['workload', W], ['verification-quality', W],
  ['fairness', 'scheme=TOP_CLASS&academic_year=2026-27&include_fixtures=true'],
  ['fairness', 'scheme=TOP_CLASS&academic_year=2033-34&include_fixtures=true'],
];

log('=== A5.5 every view: CSV, XLSX and PDF hold the same table (SUPER_ADMIN, fixtures included)');
const audit0 = psql('SELECT last_seq FROM audit_chain_head;');
const counts = () => psql(`SELECT string_agg(t||'='||c, ' ' ORDER BY t) FROM (SELECT 'applications' t, count(*) c FROM applications UNION ALL SELECT 'documents', count(*) FROM documents UNION ALL SELECT 'notifications', count(*) FROM notifications UNION ALL SELECT 'decision_records', count(*) FROM decision_records UNION ALL SELECT 'sla_breaches', count(*) FROM sla_breaches UNION ALL SELECT 'authorization_denials', count(*) FROM authorization_denials) x;`);
const counts0 = counts();
let calls = 0;
for (const [view, q] of VIEWS) {
  const csv = await get(`${view}/export.csv?${q}`);
  const x = await get(`${view}/export.xlsx?${q}`);
  const p = await get(`${view}/export.pdf?${q}`);
  calls += 3;
  const grid = parseCsv(csv.buf.toString('utf8'));
  const [data, meta] = xlsxGrid(x.buf);
  const numericNorm = (g) => g.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? String(Number(c)) : c)));
  const runs = pdfRuns(p.buf).join('').replace(/\s+/g, '');
  // Row by row, in order (a table longer than a page repeats its header after each page's footer).
  let at = 0;
  const inOrder = grid.every((row) => { const i = runs.indexOf(row.join('').replace(/\s+/g, ''), at); if (i < 0) return false; at = i + 1; return true; });
  const pages = (p.buf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
  const markers = grid.flat().filter((c) => c === '<5' || c === 'suppressed').length;
  const tag = `${view}${q.includes('group_by') ? '(institution)' : ''}${view === 'fairness' ? `(${q.split('academic_year=')[1].split('&')[0]})` : ''}`;
  log(`   ${tag.padEnd(26)} csv ${csv.status} ${String(grid.length - 1).padStart(2)} rows | xlsx ${x.status} ${x.type.split(';')[0].slice(-5)} grid==csv ${eq(trim(numericNorm(data)), trim(numericNorm(grid)))} meta rows ${meta.length - 1} | pdf ${p.status} ${p.type} ${pages}p rows==csv ${inOrder} | suppressed cells ${markers}`);
  writeFileSync(`responses/p16/a-${tag}.xlsx`, x.buf);
  writeFileSync(`responses/p16/a-${tag}.pdf`, p.buf);
}
for (const [view, q] of VIEWS) { await call('GET', `/analytics/${view}?${q}`, undefined, sa, { raw: true }); calls++; }
log(`\n=== A5.6 read-only: ${calls} analytics calls (JSON + every export)`);
log(`   audit chain head: ${audit0} -> ${psql('SELECT last_seq FROM audit_chain_head;')}`);
log(`   row counts before: ${counts0}`);
log(`   row counts after : ${counts()}`);
const wl = await call('GET', `/analytics/workload?${W}`, undefined, sa, { raw: true });
log(`   meta.read_only_transaction (workload / verification-quality): ${wl.body.meta.read_only_transaction} / ${(await call('GET', `/analytics/verification-quality?${W}`, undefined, sa, { raw: true })).body.meta.read_only_transaction}`);

log('\n=== A5.7 fixtures excluded by default, included only through the restricted option');
const mo = await login('ministry.p11@example.org');
const Q = 'from=2026-09-01&to=2026-10-31&scheme=WQ_ORACLE_P16';
for (const [who, t] of [['MINISTRY_OFFICER', mo], ['SUPER_ADMIN', sa]]) {
  const a = await call('GET', `/analytics/verification-quality?${Q}`, undefined, t, { raw: true });
  const b = await call('GET', `/analytics/verification-quality?${Q}&include_fixtures=true`, undefined, t, { raw: true });
  log(`   ${who.padEnd(17)} default: HTTP ${a.status} fixtures=${a.body.meta?.fixtures} rows=${a.body.rows?.length} | include_fixtures=true: HTTP ${b.status} ${b.body.code ?? ''} ${b.body.details ? JSON.stringify(b.body.details) : `rows=${b.body.rows.length}`}`);
  const c = await call('GET', `/analytics/workload?${Q}`, undefined, t, { raw: true });
  log(`   ${who.padEnd(17)} workload default: actions rows=${c.body.actions.length} queue total=${c.body.queues.reduce((s, r) => s + (typeof r.in_queue_now === 'number' ? r.in_queue_now : 0), 0)}`);
}
log('   oracle applications tagged: ' + psql(`SELECT count(*) FROM test_fixtures f JOIN applications a ON a.id=f.entity_id JOIN schemes s ON s.id=a.scheme_id WHERE f.entity_type='application' AND s.code='WQ_ORACLE_P16';`) + ' of 12');

log('\n=== A5.8 workload is shown to state / national oversight only');
for (const who of ['ino.ranchi', 'dno.ranchi', 'sno.jharkhand', 'ministry', 'auditor.jharkhand', 'committee.ranchi', 'admin']) {
  const r = await get(`workload?from=2026-09-01&to=2026-10-31`, await login(`${who}.p11@example.org`));
  log(`   ${who.padEnd(18)} GET /analytics/workload -> ${r.status}`);
}
