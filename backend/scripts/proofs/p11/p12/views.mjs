// Phase 12 Part B: call every analytics view; save JSON and CSV responses.
import { writeFileSync, mkdirSync } from 'node:fs';
import { login, PW } from '../lib.mjs';

const API = 'http://localhost:3000/api/v1';
mkdirSync('responses/p12', { recursive: true });
export const WINDOW = 'from=2026-06-01&to=2027-06-01';
export const VIEWS = ['funnel', 'sla', 'schemes', 'disbursements', 'fraud', 'jurisdiction'];

export async function get(email, path, save) {
  const t = await login(email);
  for (;;) {
    const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after') ?? 15) + 1) * 1000));
      continue;
    }
    const type = res.headers.get('content-type') ?? '';
    const body = type.includes('json') ? await res.json() : await res.text();
    if (save) writeFileSync(`responses/p12/${save}`, typeof body === 'string' ? body : JSON.stringify(body, null, 1));
    return { status: res.status, type, body };
  }
}
void PW;

if (process.argv[1]?.endsWith('views.mjs')) {
  const who = process.argv[2] ?? 'ministry.p11@example.org';
  const extra = process.argv[3] ?? '';
  const tag = process.argv[4] ?? 'default';
  for (const v of VIEWS) {
    const r = await get(who, `/analytics/${v}?${WINDOW}${extra}`, `${tag}-${v}.json`);
    const c = await get(who, `/analytics/${v}/export.csv?${WINDOW}${extra}`, `${tag}-${v}.csv`);
    const b = r.body;
    const summary =
      v === 'funnel' ? `steps=${JSON.stringify(b.steps?.map((s) => `${s.step}:${s.count}`))} held=${b.held?.count} state_dbt=${b.state_dbt?.count}` :
      v === 'sla' ? `stages=${JSON.stringify(b.stages?.map((s) => `${s.stage}:${s.completed_stays}/${s.in_stage_now}`))}` :
      v === 'schemes' ? `rows=${JSON.stringify(b.schemes?.map((s) => `${s.scheme_code} ${s.academic_year}:${s.applications}`))}` :
      v === 'disbursements' ? `scheduled=${b.scheduled?.length} by_status=${b.by_status?.length} state=${JSON.stringify(b.handled_by_state)}` :
      v === 'fraud' ? `app_flag_rows=${b.application_flags?.length} held=${b.held_applications?.total}` :
      `rows=${b.rows?.length} total_rows=${b.total_rows} states=${JSON.stringify(b.states?.map((s) => `${s.state}:${s.applications}`))}`;
    console.log(`${v.padEnd(13)} JSON ${r.status} read_only=${b.meta?.read_only_transaction} fixtures=${b.meta?.fixtures} ${r.status === 200 ? summary : JSON.stringify(b)}`);
    console.log(`${''.padEnd(13)} CSV  ${c.status} ${c.type.split(';')[0]} ${typeof c.body === 'string' ? c.body.split('\r\n').length - 2 + ' data rows' : JSON.stringify(c.body)}`);
  }
}
