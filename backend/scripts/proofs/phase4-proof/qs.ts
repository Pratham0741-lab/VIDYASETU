import { readFileSync } from 'node:fs';
import { evaluateScheme } from '../vidyasetu/api/src/schemes/eligibility-engine';
import { toPersisted } from '../vidyasetu/api/src/schemes/redaction';
const seed = JSON.parse(readFileSync('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/prisma/scheme_versions_seed_v2.json', 'utf8'));
const cfg = seed.find((v: any) => v.scheme_code === 'NOS' && v.version_no === 2).config;
for (const qs of [450, 1500, undefined]) {
  const r = evaluateScheme(cfg, { university_qs_ranking: qs, family_income_annual: 400000 }).rules.find((x) => x.rule_id === 'nos_selection_priority_rules')!;
  const stored = toPersisted(r);
  console.log(`qs=${qs} verdict=${r.verdict} result_value=${JSON.stringify(stored.result_value)} stored trace.trace=${JSON.stringify((stored.trace as any).trace ?? stored.trace)}`);
}
