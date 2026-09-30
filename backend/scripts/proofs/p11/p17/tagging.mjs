// Phase 17 proof 12: every row of test data is tagged in test_fixtures (zero untagged).
import { readFileSync } from 'node:fs';
import { psql } from '../psql.mjs';

const T = [
  ['accounts', 'account'], ['officers', 'officer'], ['applicants', 'applicant'], ['applications', 'application'],
  ['documents', 'document'], ['selections', 'selection'], ['sanction_orders', 'sanction_order'],
  ['disbursements', 'disbursement'], ['fraud_flags', 'fraud_flag'], ['deficiencies', 'deficiency'],
  ['deficiency_items', 'deficiency_item'], ['applicant_profile_changes', 'applicant_profile_change'],
  ['selection_lists', 'selection_list'], ['selection_list_entries', 'selection_list_entry'],
  ['selection_committee_decisions', 'selection_committee_decision'],
  // Phase 14
  ['sla_breaches', 'sla_breach'], ['application_drafts', 'application_draft'],
  ['aadhaar_authentications', 'aadhaar_authentication'], ['renewals', 'renewal'],
  // Phase 16
  ['officer_preferences', 'officer_preference'],
  // Phase 17
  ['consent_records', 'consent_record'], ['correction_requests', 'correction_request'],
  ['correction_decisions', 'correction_decision'], ['erasure_requests', 'erasure_request'],
  ['document_access_log', 'document_access'], ['retention_runs', 'retention_run'],
  ['notifications', 'notification'], ['refresh_tokens', 'refresh_token'],
];
const seedCodes = [...new Set(JSON.parse(readFileSync('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/prisma/scheme_versions_seed_v2.json', 'utf8')).map((v) => v.scheme_code))];
const codes = seedCodes.map((c) => `'${c}'`).join(',');
const q = [
  ...T.map(([t, e]) => `SELECT '${t}'||'|'||count(*) FROM ${t} x WHERE NOT EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type='${e}' AND f.entity_id=x.id)`),
  `SELECT 'schemes (not in the seed)'||'|'||count(*) FROM schemes x WHERE x.code NOT IN (${codes}) AND NOT EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type='scheme' AND f.entity_id=x.id)`,
  `SELECT 'scheme_versions (of non-seed schemes)'||'|'||count(*) FROM scheme_versions x JOIN schemes s ON s.id=x.scheme_id WHERE s.code NOT IN (${codes}) AND NOT EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type='scheme_version' AND f.entity_id=x.id)`,
].join(' UNION ALL ') + ';';
console.log('p17 fixture tags: ' + psql(`SELECT string_agg(label||'/'||entity_type||'='||c, '  ' ORDER BY label, entity_type) FROM (SELECT label, entity_type, count(*) c FROM test_fixtures WHERE label = 'p17-fixture' OR entity_type IN ('notification','refresh_token') GROUP BY 1, 2) x;`));
console.log(`untagged (${T.length + 2} tables): ` + psql(q).split('\n').join('; '));
console.log('seeded schemes (real data, not fixtures): ' + seedCodes.join(', '));
