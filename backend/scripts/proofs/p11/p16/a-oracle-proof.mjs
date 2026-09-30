// Phase 16 Part A proof: officer workload and verification quality match independently written
// SQL on the hand-built oracle (a-oracle-build.mjs), in JSON, CSV, XLSX and PDF, with the
// suppression rule re-implemented here and checked in every format.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';
import { call, login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';

const CODE = 'WQ_ORACLE_P16';
const FROM = '2026-09-01';
const TO = '2026-10-31';
const Q = `from=${FROM}&to=${TO}&scheme=${CODE}&include_fixtures=true`;
const S = state.P16.wq;
const appIds = Object.values(S.apps).map((a) => `'${a.applicationId}'`).join(',');
const T = 5;
const log = (...a) => console.log(...a);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rows = (sql) => { const out = psql(sql); return out ? out.split('\n').map((l) => l.split('|')) : []; };

// ---------------------------------------------------------------- the suppression rule, re-implemented
function suppress(input, applicantKey, countKeys, groupOf = () => '') {
  const out = input.map((r) => {
    const c = { ...r };
    const whole = r[applicantKey] > 0 && r[applicantKey] < T;
    for (const k of countKeys) c[k] = whole && r[k] > 0 ? '<5' : r[k] > 0 && r[k] < T ? '<5' : r[k];
    return c;
  });
  const groups = {};
  input.forEach((r, i) => (groups[groupOf(r)] ??= []).push(i));
  for (const idx of Object.values(groups)) {
    for (const k of countKeys) {
      const masked = idx.filter((i) => out[i][k] === '<5' || out[i][k] === 'suppressed');
      if (masked.length !== 1) continue;
      const cands = idx.filter((i) => typeof out[i][k] === 'number' && out[i][k] > 0).sort((a, b) => out[a][k] - out[b][k]);
      if (cands.length) out[cands[0]][k] = 'suppressed';
    }
  }
  return out;
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const x = (s.length - 1) * p; const lo = Math.floor(x); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (x - lo); };

// ================================================================ ORACLE: workload (independent SQL)
log('=== A5.1 workload oracle (independent SQL: one row per officer action, grouped here)');
const W0 = `'${FROM}'::timestamptz`, W1 = `'${TO}'::timestamptz`;
const acts = rows(`
  SELECT r.name, CASE WHEN o.jurisdiction_state IS NULL THEN 'NATIONAL' WHEN o.jurisdiction_district IS NULL THEN 'STATE' ELSE 'DISTRICT' END,
         o.id, 'decision:'||d.decision, coalesce(d.reasons->>'eligibility_review_confirmed','false'),
         coalesce(d.reasons->>'workflow_transition_id',''), d.application_id
    FROM decision_records d JOIN officers o ON o.id=d.officer_id JOIN roles r ON r.id=o.role_id
   WHERE d.application_id IN (${appIds}) AND d.created_at >= ${W0} AND d.created_at < ${W1}
  UNION ALL
  SELECT r.name, CASE WHEN o.jurisdiction_state IS NULL THEN 'NATIONAL' WHEN o.jurisdiction_district IS NULL THEN 'STATE' ELSE 'DISTRICT' END,
         o.id, 'confirm', (coalesce(jsonb_array_length(e.corrected_fields),0) > 0 OR e.classification_matches_slot = false)::text, '', e.application_id
    FROM document_extractions e JOIN officers o ON o.id=e.confirmed_by_officer_id JOIN roles r ON r.id=o.role_id
   WHERE e.application_id IN (${appIds}) AND e.confirmed_at >= ${W0} AND e.confirmed_at < ${W1};`);
log(`   ${acts.length} officer actions on the oracle's applications`);
log('   other action sources on them (fraud reviews / selection confirmations / committee decisions): ' + psql(`SELECT (SELECT count(*) FROM fraud_flags WHERE application_id IN (${appIds}) AND reviewed_by_officer_id IS NOT NULL)||' / '||(SELECT count(*) FROM selections WHERE application_id IN (${appIds}) AND confirmed_by_officer_id IS NOT NULL)||' / '||(SELECT count(*) FROM selection_committee_decisions cd JOIN selection_list_entries e ON e.id=cd.entry_id WHERE e.application_id IN (${appIds}));`));
// Handling time: from the latest entry into the decision's from_stage to the decision.
const trans = rows(`SELECT id, application_id, from_stage, to_stage, extract(epoch FROM created_at)::float8 FROM workflow_transitions WHERE application_id IN (${appIds});`);
const byId = Object.fromEntries(trans.map((t) => [t[0], t]));
const handling = (tid) => {
  const t = byId[tid];
  if (!t) return null;
  const entered = trans.filter((p) => p[1] === t[1] && p[3] === t[2] && Number(p[4]) < Number(t[4])).map((p) => Number(p[4]));
  return entered.length ? Number(t[4]) - Math.max(...entered) : null;
};
const groups = {};
for (const [role, level, officer, action, override, tid] of acts) {
  const g = (groups[`${role}|${level}`] ??= { role, level, officers: new Set(), counts: {}, overrides: 0, times: [] });
  const a = { 'decision:APPROVE': 'verify', 'decision:REJECT': 'reject', 'decision:DEFECT': 'defective', confirm: 'document_confirm' }[action] ?? 'other';
  g.counts[a] = (g.counts[a] ?? 0) + 1;
  g.officers.add(officer);
  if (override === 'true') g.overrides++;
  if (action.startsWith('decision:')) { const h = handling(tid); if (h !== null) g.times.push(h); }
}
const CK = ['actions_total', 'verify', 'reject', 'defective', 'document_confirm', 'fraud_review', 'selection_confirm', 'committee_decision', 'other', 'overrides', 'officers_active'];
const oracleActions = Object.values(groups).sort((a, b) => (a.role + a.level).localeCompare(b.role + b.level)).map((g) => ({
  role: g.role, level: g.level,
  actions_total: Object.values(g.counts).reduce((x, y) => x + y, 0),
  verify: g.counts.verify ?? 0, reject: g.counts.reject ?? 0, defective: g.counts.defective ?? 0,
  document_confirm: g.counts.document_confirm ?? 0, fraud_review: 0, selection_confirm: 0, committee_decision: 0,
  other: g.counts.other ?? 0, overrides: g.overrides, officers_active: g.officers.size,
  _times: g.times,
}));
for (const r of oracleActions) log(`   raw ${r.role}/${r.level}: ${JSON.stringify(Object.fromEntries(CK.map((k) => [k, r[k]])))} timed=${r._times.length} median_h=${pct(r._times, 0.5) === null ? '-' : (pct(r._times, 0.5) / 3600).toFixed(4)} p90_h=${pct(r._times, 0.9) === null ? '-' : (pct(r._times, 0.9) / 3600).toFixed(4)}`);
const expActions = suppress(oracleActions.map((r) => ({ ...r })), 'actions_total', CK).map((r, i) => {
  const src = oracleActions[i];
  const shown = src.officers_active >= T && src._times.length >= T;
  const { _times, ...rest } = r;
  return { ...rest, bulk_actions: null, median_handling_hours: shown ? Math.round(pct(_times, 0.5) / 360) / 10 : 'suppressed', p90_handling_hours: shown ? Math.round(pct(_times, 0.9) / 360) / 10 : 'suppressed' };
});
const STAGES = { INO_VERIFIED: 7, DNO_VERIFIED: 7, SNO_VERIFIED: 10, MINISTRY_APPROVED: 15, DEFECTIVE: 15 };
const ROLE = { INO_VERIFIED: 'INSTITUTE_NODAL_OFFICER', DNO_VERIFIED: 'DISTRICT_NODAL_OFFICER', SNO_VERIFIED: 'STATE_NODAL_OFFICER', MINISTRY_APPROVED: 'MINISTRY_OFFICER', DEFECTIVE: null };
const qraw = Object.keys(STAGES).sort().map((stage) => {
  const [inq, past, br] = rows(`SELECT (SELECT count(*) FROM applications WHERE id IN (${appIds}) AND current_stage='${stage}'), (SELECT count(*) FROM applications WHERE id IN (${appIds}) AND current_stage='${stage}' AND stage_due_at < now()), (SELECT count(*) FROM sla_breaches WHERE application_id IN (${appIds}) AND stage='${stage}' AND detected_at >= ${W0} AND detected_at < ${W1});`)[0].map(Number);
  return { stage, role: ROLE[stage], sla_days: STAGES[stage], in_queue_now: inq, past_sla_now: past, breaches_recorded: br };
});
log('   raw queues: ' + qraw.map((q) => `${q.stage}=${q.in_queue_now}/${q.past_sla_now}/${q.breaches_recorded}`).join(' '));
const expQueues = suppress(qraw, 'in_queue_now', ['in_queue_now', 'past_sla_now', 'breaches_recorded']);

// ================================================================ ORACLE: verification quality
log('\n=== A5.2 verification-quality oracle (independent SQL: one row per document)');
const MAP = { 'Family Income Certificate': 'INCOME_CERTIFICATE', 'ST certificate issued by competent authority': 'CASTE_CERTIFICATE' };
const docs = rows(`
  SELECT d.document_type, d.source, coalesce(d.intake_status,''), coalesce(x.status,''), coalesce(x.review_status,''),
         coalesce(jsonb_array_length(x.corrected_fields),0), coalesce(x.classification_matches_slot::text,'')
    FROM documents d
    LEFT JOIN document_extractions x ON x.document_id = d.id
     AND x.created_at = (SELECT max(created_at) FROM document_extractions y WHERE y.document_id = d.id)
   WHERE d.application_id IN (${appIds}) AND d.created_at >= ${W0} AND d.created_at < ${W1};`);
log(`   ${docs.length} documents`);
const VK = ['uploaded', 'rejected_unreadable', 'processed', 'extraction_failed', 'auto_verified', 'sent_to_review', 'awaiting_officer', 'officer_decided', 'officer_corrected', 'type_overridden', 'overridden'];
const vq = {};
for (const [slot, source, intake, status, review, corrected, matches] of docs) {
  const k = `${CODE}|${MAP[slot]}|${source}`;
  const r = (vq[k] ??= { scheme_code: CODE, document_type: MAP[slot], source, ...Object.fromEntries(VK.map((x) => [x, 0])) });
  const decided = review === 'OFFICER_CONFIRMED';
  r.uploaded++;
  if (intake === 'QUALITY_REJECTED') r.rejected_unreadable++;
  if (status) r.processed++;
  if (status === 'FAILED') r.extraction_failed++;
  if (review === 'AUTO_ACCEPTED') r.auto_verified++;
  if (review === 'NEEDS_REVIEW' || decided) r.sent_to_review++;
  if (review === 'NEEDS_REVIEW') r.awaiting_officer++;
  if (decided) r.officer_decided++;
  if (decided && Number(corrected) > 0) r.officer_corrected++;
  if (decided && matches === 'false') r.type_overridden++;
  if (decided && (Number(corrected) > 0 || matches === 'false')) r.overridden++;
}
const vraw = Object.keys(vq).sort().map((k) => vq[k]);
for (const r of vraw) log(`   raw ${r.document_type}/${r.source}: ${JSON.stringify(Object.fromEntries(VK.map((k) => [k, r[k]])))} true auto_accept_rate=${(r.auto_verified / (r.auto_verified + r.sent_to_review)).toFixed(4)} true override_rate=${r.officer_decided ? (r.overridden / r.officer_decided).toFixed(4) : '-'}`);
const rate = (n, d) => (typeof n === 'number' && typeof d === 'number' ? (d === 0 ? null : Math.round((n / d) * 10000) / 10000) : 'suppressed');
const expVq = suppress(vraw, 'uploaded', VK, (r) => r.scheme_code).map((r) => ({
  ...r,
  auto_accept_rate: r.source === 'DIGILOCKER' ? null : rate(r.auto_verified, typeof r.auto_verified === 'number' && typeof r.sent_to_review === 'number' ? r.auto_verified + r.sent_to_review : 'suppressed'),
  override_rate: rate(r.overridden, r.officer_decided),
}));

// ================================================================ API JSON vs oracle
log('\n=== A5.3 API JSON (SUPER_ADMIN, include_fixtures=true, scheme=' + CODE + ') vs oracle');
const sa = await login('admin.p11@example.org');
const wl = await call('GET', `/analytics/workload?${Q}`, undefined, sa, { raw: true });
writeFileSync('responses/p16/a-workload.json', JSON.stringify(wl, null, 1));
const vqr = await call('GET', `/analytics/verification-quality?${Q}`, undefined, sa, { raw: true });
writeFileSync('responses/p16/a-verification-quality.json', JSON.stringify(vqr, null, 1));
log(`   GET /analytics/workload HTTP ${wl.status} read_only_transaction=${wl.body.meta.read_only_transaction}; actions rows=${wl.body.actions.length} queues=${wl.body.queues.length}`);
for (const r of wl.body.actions) log(`     ${JSON.stringify(r)}`);
for (const r of wl.body.queues) log(`     ${JSON.stringify(r)}`);
log(`   actions == oracle: ${eq(wl.body.actions, expActions)}   queues == oracle: ${eq(wl.body.queues, expQueues)}`);
if (!eq(wl.body.actions, expActions)) log('   EXPECTED ' + JSON.stringify(expActions));
if (!eq(wl.body.queues, expQueues)) log('   EXPECTED ' + JSON.stringify(expQueues));
log(`   GET /analytics/verification-quality HTTP ${vqr.status}; rows=${vqr.body.rows.length}`);
for (const r of vqr.body.rows) log(`     ${JSON.stringify(r)}`);
log(`   rows == oracle: ${eq(vqr.body.rows, expVq)}`);
if (!eq(vqr.body.rows, expVq)) log('   EXPECTED ' + JSON.stringify(expVq));
log(`   meaning: ${vqr.body.meta.meaning}`);

// The service's own (unsuppressed) handling times vs the oracle, from the same service SQL run as owner.
log('   service handling-time SQL (unsuppressed, owner) vs oracle:');
const svcTimes = rows(`
  WITH acts AS (
    SELECT d.officer_id, extract(epoch FROM t.created_at - (SELECT max(p.created_at) FROM workflow_transitions p
             WHERE p.application_id = d.application_id AND p.to_stage = t.from_stage AND p.created_at < t.created_at)) AS h
      FROM decision_records d
      LEFT JOIN workflow_transitions t ON t.id = (d.reasons->>'workflow_transition_id')::uuid AND t.application_id = d.application_id
     WHERE d.application_id IN (${appIds}) AND d.created_at >= ${W0} AND d.created_at < ${W1})
  SELECT r.name, CASE WHEN o.jurisdiction_state IS NULL THEN 'NATIONAL' WHEN o.jurisdiction_district IS NULL THEN 'STATE' ELSE 'DISTRICT' END,
         count(h), round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h) / 3600)::numeric, 4), round((percentile_cont(0.9) WITHIN GROUP (ORDER BY h) / 3600)::numeric, 4)
    FROM acts JOIN officers o ON o.id = acts.officer_id JOIN roles r ON r.id = o.role_id GROUP BY 1, 2 ORDER BY 1, 2;`);
for (const [role, level, n, med, p90] of svcTimes) {
  const o = oracleActions.find((x) => x.role === role && x.level === level);
  log(`     ${role}/${level}: service n=${n} median=${med} p90=${p90} | oracle n=${o._times.length} median=${(pct(o._times, 0.5) / 3600).toFixed(4)} p90=${(pct(o._times, 0.9) / 3600).toFixed(4)}`);
}

// ================================================================ exports vs oracle
const WCOLS = ['section', 'role', 'level', 'actions_total', 'verify', 'reject', 'defective', 'document_confirm', 'fraud_review', 'selection_confirm', 'committee_decision', 'other', 'overrides', 'bulk_actions', 'officers_active', 'median_handling_hours', 'p90_handling_hours', 'stage', 'sla_days', 'in_queue_now', 'past_sla_now', 'breaches_recorded'];
const VCOLS = ['scheme_code', 'document_type', 'source', ...VK, 'auto_accept_rate', 'override_rate'];
const expTables = {
  workload: { cols: WCOLS, rows: [...expActions.map((r) => ({ section: 'actions', ...r })), ...expQueues.map((r) => ({ section: 'queue', ...r }))] },
  'verification-quality': { cols: VCOLS, rows: expVq },
};
const cellText = (v) => (v === null || v === undefined ? '' : String(v));
const expectedGrid = (t) => [t.cols, ...t.rows.map((r) => t.cols.map((c) => cellText(r[c])))];
const fetchBuf = async (path) => Buffer.from(await (await fetch(`http://127.0.0.1:3000/api/v1/analytics/${path}`, { headers: { Authorization: `Bearer ${sa}` } })).arrayBuffer());
const parseCsv = (s) => s.trim().split('\r\n').map((l) => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; });
const xlsxGrid = (buf, sheet) => JSON.parse(execFileSync('python', ['-c', `
import zipfile, io, sys, json, re, xml.etree.ElementTree as ET
z = zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
root = ET.fromstring(z.read('xl/worksheets/${sheet}.xml'))
grid = []
for row in root.find('m:sheetData', ns):
    cells = {}
    for c in row:
        col = re.match(r'[A-Z]+', c.get('r')).group(0)
        idx = 0
        for ch in col: idx = idx * 26 + (ord(ch) - 64)
        if c.get('t') == 'inlineStr': cells[idx - 1] = ''.join(t.text or '' for t in c.iter('{%s}t' % ns['m']))
        else:
            v = c.find('m:v', ns).text; f = float(v); cells[idx - 1] = str(int(f)) if f == int(f) and 'e' not in v and '.' not in v else v
    width = max(cells) + 1 if cells else 0
    grid.append([cells.get(i, '') for i in range(width)])
print(json.dumps(grid))
`], { input: buf }).toString());
const pdfRuns = (buf) => { const runs = []; const s = buf.toString('latin1'); for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) { let c; try { c = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; } for (const bt of c.matchAll(/BT([\s\S]*?)ET/g)) { const hex = [...bt[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => h[1]).join(''); if (hex) runs.push(Buffer.from(hex, 'hex').toString('latin1')); } } return runs; };
const trimGrid = (g) => g.map((r) => { const x = [...r]; while (x.length && x[x.length - 1] === '') x.pop(); return x; });

for (const [view, t] of Object.entries(expTables)) {
  log(`\n=== A5.4 ${view} exports vs oracle`);
  const exp = expectedGrid(t);
  const csv = parseCsv((await fetchBuf(`${view}/export.csv?${Q}`)).toString('utf8'));
  log(`   CSV : ${csv.length - 1} rows, grid == oracle: ${eq(csv, exp)}`);
  const x = await fetchBuf(`${view}/export.xlsx?${Q}`);
  writeFileSync(`responses/p16/a-${view}.xlsx`, x);
  const xg = xlsxGrid(x, 'sheet1');
  log(`   XLSX: ${x.length} bytes, data sheet grid == oracle: ${eq(trimGrid(xg), trimGrid(exp))}`);
  const meta = xlsxGrid(x, 'sheet2');
  log(`   XLSX metadata sheet: ${meta.slice(1).filter((r) => ['window', 'scope', 'fixtures', 'small_count_threshold'].includes(r[0])).map((r) => `${r[0]}=${r[1]}`).join(' | ')}`);
  log(`   XLSX metadata states suppressed markers: ${meta.some((r) => r[0] === 'suppression' && r[1].includes('"<5"') && r[1].includes('"suppressed"'))}`);
  const p = await fetchBuf(`${view}/export.pdf?${Q}`);
  writeFileSync(`responses/p16/a-${view}.pdf`, p);
  const runs = pdfRuns(p);
  const joined = runs.join('').replace(/\s+/g, '');
  let at = 0;
  const inOrder = exp.every((row) => { const i = joined.indexOf(row.join('').replace(/\s+/g, ''), at); if (i < 0) return false; at = i + 1; return true; });
  log(`   PDF : ${p.length} bytes, ${runs.length} text runs; header and every row, cell by cell, in table order: ${inOrder}`);
  const footer = runs.filter((r) => /window:|fixtures:|small_count_threshold|Page \d+ of/.test(r)).join(' ');
  log(`   PDF footer: ${footer.slice(0, 260)}...`);
  log(`   PDF footer has window/scope/fixtures/threshold: ${['window: 2026-09-01 to 2026-10-31', 'scope:', 'fixtures: included', 'small_count_threshold: 5'].every((f) => runs.join(' ').replace(/\s+/g, ' ').includes(f))}`);
}
