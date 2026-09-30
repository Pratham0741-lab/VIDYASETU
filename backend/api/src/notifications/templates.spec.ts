import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGES } from '../workflow/vidyasetu-workflow';
import { CATALOGUES_FOR_TEST, render, TEMPLATE_KEYS } from './templates';

/**
 * Phase 13D: every notification text exists in English AND Hindi, with the
 * same placeholders, so a new key without a Hindi version fails the build.
 * (The Hindi texts are machine-drafted and await human review:
 * docs/TRANSLATION_REVIEW.md. This test checks presence, not quality.)
 */
const LOCALES = ['en', 'hi'];
const placeholders = (t: string) => [...t.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).sort();

describe('notification template parity (en / hi)', () => {
  const { TEMPLATES, RULE_MESSAGES, QUALITY_ISSUE_MESSAGES, PARAM_MESSAGES } = CATALOGUES_FOR_TEST;

  it('every template key has an English and a Hindi text with the same placeholders', () => {
    expect(TEMPLATE_KEYS.length).toBeGreaterThanOrEqual(23);
    for (const key of TEMPLATE_KEYS) {
      for (const loc of LOCALES) {
        const t = TEMPLATES[loc]?.[key];
        expect({ key, loc, present: Boolean(t?.subject && t?.body) }).toEqual({
          key,
          loc,
          present: true,
        });
      }
      const en = TEMPLATES.en[key];
      const hi = TEMPLATES.hi[key];
      expect(placeholders(hi.subject + hi.body)).toEqual(placeholders(en.subject + en.body));
    }
    expect(Object.keys(TEMPLATES.hi).sort()).toEqual(Object.keys(TEMPLATES.en).sort());
  });

  it.each([
    ['RULE_MESSAGES', RULE_MESSAGES],
    ['QUALITY_ISSUE_MESSAGES', QUALITY_ISSUE_MESSAGES],
    ['PARAM_MESSAGES', PARAM_MESSAGES],
  ])('%s has the same keys in English and Hindi', (_name, catalogue) => {
    expect(Object.keys(catalogue.hi ?? {}).sort()).toEqual(Object.keys(catalogue.en).sort());
  });

  it('every workflow stage has a label in both languages', () => {
    for (const stage of STAGES) {
      for (const loc of LOCALES) expect(PARAM_MESSAGES[loc][`stage.${stage}`]).toBeTruthy();
    }
  });

  it('every template renders in Hindi as Hindi (no fallback)', () => {
    for (const key of TEMPLATE_KEYS) {
      expect(render(key, {}, { forStorage: true, locale: 'hi' }).locale).toBe('hi');
    }
  });

  it('every notice_templates code seeded by a migration has an English and a Hindi row', () => {
    const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
    const rows = new Map<string, Set<string>>();
    for (const m of readdirSync(dir)) {
      const sql = readFileSync(join(dir, m, 'migration.sql'), 'utf8');
      if (!sql.includes('INSERT INTO "notice_templates"')) continue;
      for (const r of sql.matchAll(
        /\(gen_random_uuid\(\), '([^']+)', '[^']*', 'PORTAL', '([a-z]+)'/g,
      )) {
        if (!rows.has(r[1])) rows.set(r[1], new Set());
        rows.get(r[1])!.add(r[2]);
      }
    }
    expect(rows.size).toBeGreaterThanOrEqual(29);
    for (const [code, locales] of rows) {
      expect({ code, locales: [...locales].sort() }).toEqual({ code, locales: LOCALES });
    }
  });
});
