import * as fs from 'fs';
import * as path from 'path';

interface PredicateRule {
  id: string;
  type: string;
  expr: string;
  params: Record<string, any>;
  doc_refs: string[];
  message_key: string;
  verification?: {
    status: string;
    source_clause?: string;
    audited_by?: string | null;
    audited_at?: string | null;
  };
}

interface SchemeVersionSeedEntry {
  scheme_code: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  config: {
    rules: PredicateRule[];
    benefits: any[];
    required_documents: string[];
    fund_sharing_ratio: string | null;
    metadata?: Record<string, any>;
  };
}

interface RuleParamMismatch {
  scheme_code: string;
  version_no: number;
  rule_id: string;
  missing_key: string;
  expr: string;
}

function resolveSeedFilePath(): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'scheme_versions_seed_v2.json'),
    path.resolve(__dirname, '../scheme_versions_seed_v2.json'),
    path.resolve(__dirname, '../../scheme_versions_seed_v2.json'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error(
    `[ERROR] Could not locate "scheme_versions_seed_v2.json". Attempted:\n` +
      candidatePaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
  );
}

export function validateRuleParams(): {
  mismatches: RuleParamMismatch[];
  totalEntries: number;
  totalRules: number;
  totalTokens: number;
} {
  const seedPath = resolveSeedFilePath();
  const raw = fs.readFileSync(seedPath, 'utf-8');
  const entries: SchemeVersionSeedEntry[] = JSON.parse(raw);

  const mismatches: RuleParamMismatch[] = [];
  let totalRules = 0;
  let totalTokens = 0;

  const paramRegex = /params\.(\w+)/g;

  for (const entry of entries) {
    const rules = entry.config?.rules || [];
    for (const rule of rules) {
      totalRules++;
      if (!rule.expr || typeof rule.expr !== 'string') continue;

      paramRegex.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = paramRegex.exec(rule.expr)) !== null) {
        totalTokens++;
        const referencedKey = match[1];
        const paramsObj = rule.params || {};

        if (!Object.prototype.hasOwnProperty.call(paramsObj, referencedKey)) {
          mismatches.push({
            scheme_code: entry.scheme_code,
            version_no: entry.version_no,
            rule_id: rule.id,
            missing_key: referencedKey,
            expr: rule.expr,
          });
        }
      }
    }
  }

  return {
    mismatches,
    totalEntries: entries.length,
    totalRules,
    totalTokens,
  };
}

function main() {
  console.log('============================================================');
  console.log('🔍 Validating Rule Expression Parameters (scheme_versions_seed_v2.json)');
  console.log('============================================================\n');

  const { mismatches, totalEntries, totalRules, totalTokens } = validateRuleParams();

  if (mismatches.length > 0) {
    console.error(`❌ Found ${mismatches.length} rule parameter mismatch(es):\n`);
    for (const m of mismatches) {
      console.error(
        `  • Scheme: ${m.scheme_code} v${m.version_no} | Rule: "${m.rule_id}" | Missing param key: "${m.missing_key}"`
      );
      console.error(`    Expression: ${m.expr}\n`);
    }
    console.error('Validation failed: Some expressions reference parameters missing from their params object.');
    process.exit(1);
  }

  console.log(`✅ All rule expression parameters validated successfully!`);
  console.log(`   - Scheme versions checked     : ${totalEntries}`);
  console.log(`   - Total rules inspected       : ${totalRules}`);
  console.log(`   - Total params.* tokens verified: ${totalTokens}`);
  console.log(`   - Parameter mismatches found  : 0\n`);
  process.exit(0);
}

main();
