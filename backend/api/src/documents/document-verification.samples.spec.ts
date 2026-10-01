import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CanonicalDocumentType } from './document-types';
import { schemeLimits, VerificationContext, verifyDocument } from './document-verification';

/**
 * The verification rules over the ml sample evaluation (ml/tests/sample_eval.py
 * writes eval_<tag>.json OUTSIDE the repo: it holds sample text). Skipped
 * unless EVAL_RESULTS points at that file:
 *
 *   EVAL_RESULTS=/tmp/vs-eval/eval_clean.json npx jest document-verification.samples
 *
 * Each good sample is checked as if the applicant had entered exactly what the
 * document says (its labels), against the seeded scheme's own limits.
 */
// A test-only switch (the sample results live outside the repo), not app configuration.
// eslint-disable-next-line no-restricted-properties
const path = process.env.EVAL_RESULTS;
const run = path ? describe : describe.skip;

interface EvalRow {
  file: string;
  document_type: CanonicalDocumentType;
  good: boolean;
  expected: Record<string, string | number>;
  extracted: Record<string, unknown>;
}

function schemeConfig(): unknown {
  const seed = JSON.parse(
    readFileSync(join(__dirname, '../../prisma/scheme_versions_seed_v2.json'), 'utf8'),
  ) as Array<{ config: unknown }>;
  // The first seeded scheme with an income ceiling (the pre-matric ST scheme).
  return seed.find((v) => schemeLimits(v.config).income_ceiling !== null)?.config ?? seed[0].config;
}

function contextFor(row: EvalRow, limits: ReturnType<typeof schemeLimits>): VerificationContext {
  const e = row.expected;
  const name = (e.applicant_name ?? e.candidate_name ?? e.student_name ?? null) as string | null;
  // The application is made just after the document was issued (its own date
  // when the label has none), and the applicant entered what the document says.
  const date = typeof e.issued_date === 'string' ? e.issued_date : row.extracted.issued_date;
  const issued = typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : null;
  const now = issued ? new Date(issued.getTime() + 30 * 86_400_000) : new Date();
  return {
    applicant_name: name,
    category: (e.category as string) ?? 'ST',
    entered_income: typeof e.family_income_annual === 'number' ? e.family_income_annual : null,
    entered_percentage: typeof e.percentage === 'number' ? e.percentage : null,
    entered_marks: null,
    institution_name: (e.institution_name as string) ?? null,
    institution_code: null,
    academic_year: ((e.academic_year ?? row.extracted.academic_year) as string) ?? null,
    ...limits,
    // The sample incomes are real certificates, not this scheme's applicants:
    // the ceiling check is exercised by the unit tests; here it must not mask extraction.
    income_ceiling: Math.max(limits.income_ceiling ?? 0, 10_000_000),
    now,
  };
}

run('verification rules over the sample evaluation', () => {
  it('every good sample verifies', () => {
    const { results } = JSON.parse(readFileSync(path!, 'utf8')) as { results: EvalRow[] };
    const limits = schemeLimits(schemeConfig());
    const failures: string[] = [];
    const byType: Record<string, { good: number; verified: number }> = {};
    for (const row of results.filter((r) => r.good)) {
      const v = verifyDocument(row.document_type, row.extracted, contextFor(row, limits));
      const t = (byType[row.document_type] ??= { good: 0, verified: 0 });
      t.good += 1;
      if (v?.result === 'VERIFIED') t.verified += 1;
      else
        failures.push(
          `${row.file}: ${v?.result} ${JSON.stringify(v?.checks.filter((c) => c.status !== 'PASS' && c.status !== 'SKIPPED'))}`,
        );
    }
    console.log(JSON.stringify(byType), failures.join('\n'));
    expect(failures).toEqual([]);
  });
});
