import { canonicalTypeForSlot } from '../documents/document-types';
import { MlClientService } from './ml-client.service';
import type {
  ClassificationResult,
  ConsistencyResult,
  ExtractionResult,
  QualityResult,
} from './document-api';

/**
 * MOCK document intelligence (ML_MODE=mock). NOT real image analysis: every
 * result below is a documented fixture, chosen by a marker embedded in the
 * uploaded file's bytes (the contract passes only the image, so the marker
 * travels inside it - e.g. a PNG tEXt chunk or any byte run):
 *
 *   VIDYASETU-MOCK-FIXTURE:<scenario>[;key=value]...;END
 *
 * The ";END" terminator is required for params to be exact: file formats
 * put arbitrary bytes after the marker (a PNG chunk's CRC, say), and those
 * can be printable. Without it, only the scenario name is honoured.
 *
 * Scenarios:
 *   clean                    every field confidence > 0.9 (the default when
 *                            no marker is present)
 *   low_confidence_field     one field (param low=<field>) at 0.55, the rest
 *                            high
 *   quality_fail             usable: false with realistic issue strings
 *   ambiguous_classification top confidence < 0.6 with real alternatives
 * Params (URL-encoded values): type=<document type returned by
 * classification>, and any extracted field, e.g.
 * holder_name=Kavya%20Oraon;family_income_annual=900000.
 *
 * Consistency is computed from the extracted values it receives, so the two
 * consistency scenarios are triggered by the names on the documents:
 *   same normalised holder_name on every document  -> names_match true (0.97)
 *   one name an initialled/partial form of another -> UNCERTAIN (confidence 0.5)
 *   otherwise different names                      -> names_match false (0.95)
 *
 * Only ml-client.module.ts may reference this class (provider factory).
 * getHealth() is inherited unchanged, so health checks still hit the real
 * ml service.
 */
export const MOCK_FIXTURE_MARKER = 'VIDYASETU-MOCK-FIXTURE:';

export type MockScenario =
  'clean' | 'low_confidence_field' | 'quality_fail' | 'ambiguous_classification';

const SCENARIOS: readonly MockScenario[] = [
  'clean',
  'low_confidence_field',
  'quality_fail',
  'ambiguous_classification',
];

export interface MockFixture {
  scenario: MockScenario;
  params: Record<string, string>;
  /** False when the file carried no marker (default fixture used). */
  marked: boolean;
}

/** Reads the fixture marker from the file bytes. */
export const MOCK_FIXTURE_END = ';END';

export function readMockFixture(image: Buffer): MockFixture {
  const at = image.indexOf(MOCK_FIXTURE_MARKER, 0, 'latin1');
  if (at === -1) return { scenario: 'clean', params: {}, marked: false };
  const start = at + MOCK_FIXTURE_MARKER.length;
  const endAt = image.indexOf(MOCK_FIXTURE_END, start, 'latin1');
  let body: string;
  let exact = true;
  if (endAt !== -1) {
    body = image.subarray(start, endAt).toString('latin1');
  } else {
    // No terminator: honour only a known scenario name found at the marker
    // (longest match), never params.
    const rest = image.subarray(start, start + 64).toString('latin1');
    body = [...SCENARIOS].sort((a, b) => b.length - a.length).find((n) => rest.startsWith(n)) ?? '';
    exact = false;
  }
  const [head, ...pairs] = body.split(';');
  const scenario = (SCENARIOS as readonly string[]).includes(head)
    ? (head as MockScenario)
    : 'clean';
  const params: Record<string, string> = {};
  if (exact) {
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq > 0) params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1));
    }
  }
  return { scenario, params, marked: true };
}

/** Field set the mock "reads" for a document type (keyword match on the slot name). */
function fieldsFor(documentType: string): Array<[string, unknown]> {
  const t = documentType.toLowerCase();
  if (t.includes('income')) {
    return [
      ['holder_name', 'MOCK HOLDER'],
      ['family_income_annual', 180000],
      ['certificate_number', 'MOCK-INC-0001'],
      ['issue_date', '2026-04-01'],
    ];
  }
  if (t.includes('caste') || /\b(st|pvtg)\b.*certificate/.test(t) || t.includes('st/pvtg')) {
    return [
      ['holder_name', 'MOCK HOLDER'],
      ['category', 'ST'],
      ['caste_cert_number', 'MOCK-ST-0001'],
    ];
  }
  if (t.includes('passbook') || t.includes('bank')) {
    return [
      ['holder_name', 'MOCK HOLDER'],
      ['bank_account', 'MOCK0000001:000000000001'],
    ];
  }
  return [
    ['holder_name', 'MOCK HOLDER'],
    ['document_number', 'MOCK-DOC-0001'],
    ['issue_date', '2026-04-01'],
  ];
}

const HIGH = [0.97, 0.96, 0.95, 0.94, 0.93];

function normaliseName(v: unknown): string {
  return typeof v === 'string'
    ? v
        .toLowerCase()
        .replace(/[^a-z ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

/** "k oraon" vs "kavya oraon": same surname, given name reduced to an initial. */
function partialMatch(a: string, b: string): boolean {
  const [pa, pb] = [a.split(' '), b.split(' ')];
  if (pa.length !== pb.length || pa.length < 2) return false;
  return pa.every(
    (w, i) =>
      w === pb[i] ||
      (w.length === 1 && pb[i].startsWith(w)) ||
      (pb[i].length === 1 && w.startsWith(pb[i])),
  );
}

export class MockMlService extends MlClientService {
  override get engineLabel(): string {
    return 'MOCK_ML';
  }

  override checkQuality(image: Buffer): Promise<QualityResult> {
    const fx = readMockFixture(image);
    const base = { mock: true, fixture: fx.scenario, fixture_marked: fx.marked };
    if (fx.scenario === 'quality_fail') {
      return Promise.resolve({
        value: {
          usable: false,
          issues: [
            'image_blurred: text edge sharpness 0.21 is below the 0.45 minimum',
            'glare_detected: 18% of the page area is overexposed',
            'page_cropped: the bottom edge of the document is cut off',
          ],
        },
        confidence: 0.93,
        details: { ...base, sharpness: 0.21, glare_ratio: 0.18 },
      });
    }
    return Promise.resolve({
      value: { usable: true, issues: [] },
      confidence: 0.96,
      details: { ...base, sharpness: 0.82, glare_ratio: 0.01 },
    });
  }

  override classifyDocument(image: Buffer): Promise<ClassificationResult> {
    const fx = readMockFixture(image);
    // Canonical type, like the real classifier (a fixture may name a slot).
    const type = fx.params.type
      ? (canonicalTypeForSlot(fx.params.type) ?? fx.params.type)
      : 'unknown_document';
    if (fx.scenario === 'ambiguous_classification') {
      return Promise.resolve({
        value: type,
        confidence: 0.52,
        alternatives: [
          { type: 'bonafide_certificate', confidence: 0.41 },
          { type: 'marksheet', confidence: 0.07 },
        ],
      });
    }
    return Promise.resolve({
      value: type,
      confidence: fx.params.type ? 0.95 : 0.5,
      alternatives: [{ type: 'marksheet', confidence: 0.03 }],
    });
  }

  override extractFields(image: Buffer, documentType: string | null): Promise<ExtractionResult> {
    const fx = readMockFixture(image);
    const fields = fieldsFor(documentType ?? '');
    const value: Record<string, unknown> = {};
    const confidence: Record<string, number> = {};
    const low = fx.scenario === 'low_confidence_field' ? (fx.params.low ?? fields[1][0]) : null;
    fields.forEach(([key, fallback], i) => {
      const given = fx.params[key];
      value[key] =
        given === undefined ? fallback : typeof fallback === 'number' ? Number(given) : given;
      confidence[key] = key === low ? 0.55 : HIGH[i % HIGH.length];
    });
    const text = Object.entries(value)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join('\n');
    return Promise.resolve({
      value,
      confidence,
      raw_text: `[MOCK OCR TEXT - fixture ${fx.scenario}, not real OCR]\n${text}`,
      // Phase 13D: fixtures have no real layout, so no field has a box.
      boxes: Object.fromEntries(Object.keys(value).map((k) => [k, null])),
    });
  }

  override checkConsistency(extractions: Record<string, unknown>[]): Promise<ConsistencyResult> {
    const names = [
      ...new Set(extractions.map((e) => normaliseName(e.holder_name)).filter(Boolean)),
    ];
    const details: Record<string, unknown> = { mock: true, documents_compared: extractions.length };
    if (names.length <= 1) {
      return Promise.resolve({
        value: { names_match: true },
        confidence: { names_match: 0.97 },
        details: { ...details, rule: 'identical normalised holder_name' },
      });
    }
    const allPartial = names.every((a) => names.every((b) => a === b || partialMatch(a, b)));
    return Promise.resolve(
      allPartial
        ? {
            value: { names_match: false },
            confidence: { names_match: 0.5 },
            details: {
              ...details,
              rule: 'initialled/partial name forms: uncertain',
              distinct_names: names.length,
            },
          }
        : {
            value: { names_match: false },
            confidence: { names_match: 0.95 },
            details: {
              ...details,
              rule: 'different holder_name values',
              distinct_names: names.length,
            },
          },
    );
  }
}
