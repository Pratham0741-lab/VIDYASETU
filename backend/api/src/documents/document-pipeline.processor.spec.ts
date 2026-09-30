import { Prisma } from '@prisma/client';
import { DOMAIN_EVENTS } from '../events/domain-events';
import { DocumentPipelineProcessor, PipelineJob } from './document-pipeline.processor';

jest.mock('../lib/crypto/pii', () => ({
  encryptPII: (plain: string) => Buffer.from(`enc:${plain.length}`),
}));

const job: PipelineJob = {
  documentId: 'doc-1',
  applicationId: 'app-1',
  applicantId: 'applicant-1',
  applicationNo: 'VS-2026-27-TEST',
  jurisdictionState: 'Jharkhand',
  jurisdictionDistrict: 'Ranchi',
  currentStage: 'INO_VERIFIED',
  schemeVersionId: 'version-1',
  slot: 'Domicile certificate',
  bucket: 'documents',
  storageKey: 'k',
  requestId: 'req-1',
};

/**
 * A recorded ML_MODE=real response for a generic identity document, here in
 * a slot with no canonical type ("Domicile certificate"): the classifier guessed
 * CASTE_CERTIFICATE at 0.12, so the caste extractor ran and returned every
 * field of that type - category null at confidence 0.
 */
interface MlResponse {
  classification: {
    value: string;
    confidence: number;
    alternatives: { type: string; confidence: number }[];
  };
  extraction: {
    value: Record<string, unknown>;
    confidence: Record<string, number>;
    raw_text: string;
  };
}

const realGenericDocument: MlResponse = {
  classification: {
    value: 'CASTE_CERTIFICATE',
    confidence: 0.12,
    alternatives: [
      { type: 'INCOME_CERTIFICATE', confidence: 0.12 },
      { type: 'MARKSHEET', confidence: 0.12 },
      { type: 'FEE_RECEIPT', confidence: 0.12 },
    ],
  },
  extraction: {
    value: {
      applicant_name: 'Anita Lakra District Ranchi',
      caste_cert_number: null,
      category: null,
      issued_date: '2026-01-10',
    },
    confidence: { applicant_name: 0.11, caste_cert_number: 0, category: 0, issued_date: 0.11 },
    raw_text: 'GOVERNMENT OF JHARKHAND\nIDENTITY CARD\nName: Anita Lakra\nDistrict: Ranchi',
  },
};

function build(response: MlResponse) {
  const created: Array<Record<string, unknown>> = [];
  const client = {
    documentExtraction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return Promise.resolve({ id: 'ext-1' });
      }),
    },
    // The gate transition and the evaluation it ran (rule reads applicant.category).
    workflowTransition: {
      findFirst: jest.fn().mockResolvedValue({ metadata: { evaluation_run_id: 'run-1' } }),
    },
    ruleEvaluation: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { expr: 'applicant.category in params.allowed_categories', trace: {} },
        ]),
    },
    applicant: {
      findUnique: jest.fn().mockResolvedValue({
        category: 'ST',
        pvtg_group: null,
        gender: 'FEMALE',
        is_disabled: false,
        disability_percentage: null,
        domicile_state: 'Jharkhand',
        domicile_district: 'Ranchi',
        income: '180000.00',
      }),
    },
    schemeVersion: { findUnique: jest.fn().mockResolvedValue(null) }, // skip the consistency step
    $queryRaw: jest.fn().mockResolvedValue([{ updated: true }]),
  };
  const events = { record: jest.fn() };
  const processor = new DocumentPipelineProcessor(
    { client } as never,
    { get: jest.fn().mockResolvedValue(Buffer.from('png')) } as never,
    {
      engineLabel: 'ML_SERVICE',
      classifyDocument: jest.fn().mockResolvedValue(response.classification),
      extractFields: jest.fn().mockResolvedValue(response.extraction),
    } as never,
    { run: jest.fn((_requestId: string, fn: () => unknown) => fn()) } as never,
    {
      documents: {
        reviewThresholds: { default: 0.85 },
        valueTolerance: 0.05,
        consistencyMinConfidence: 0.8,
      },
    } as never,
    events as never,
    { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
  );
  return { processor, client, events, created };
}

const flagCalls = (client: { $queryRaw: jest.Mock }): unknown[][] =>
  (client.$queryRaw.mock.calls as unknown[][]).filter((call) =>
    (call[0] as TemplateStringsArray).join('?').includes('document_system_flag_application'),
  );

describe('DocumentPipelineProcessor eligibility cross-check', () => {
  it('does not flag a generic document misread as a caste certificate with a null category', async () => {
    const { processor, client, events, created } = build(realGenericDocument);

    await processor.process(job, { attempt: 1, finalAttempt: true });

    expect(created).toHaveLength(1);
    expect(created[0].status).toBe('COMPLETED');
    expect(created[0].review_status).toBe('NEEDS_REVIEW'); // still reviewed, for the right reason
    expect(created[0].eligibility_mismatches).toBe(Prisma.DbNull);
    // needs_eligibility_review is raised only through this function: never called.
    expect(flagCalls(client)).toHaveLength(0);
    expect(events.record).not.toHaveBeenCalledWith(
      DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH,
      expect.anything(),
    );
  });

  it('still flags a category that was actually read and disagrees', async () => {
    const readSc: MlResponse = {
      ...realGenericDocument,
      extraction: {
        ...realGenericDocument.extraction,
        value: { ...realGenericDocument.extraction.value, category: 'SC' },
        confidence: { ...realGenericDocument.extraction.confidence, category: 0.91 },
      },
    };
    const { processor, client, events, created } = build(readSc);

    await processor.process(job, { attempt: 1, finalAttempt: true });

    expect(created[0].eligibility_mismatches).toEqual([
      { field: 'category', sensitive: false, source: 'recorded' },
    ]);
    const calls = flagCalls(client);
    expect(calls).toHaveLength(1);
    // document_system_flag_application(<application>::uuid, true, ...): raises needs_eligibility_review.
    expect(calls[0][1]).toBe('app-1');
    expect((calls[0][0] as TemplateStringsArray).join('?')).toMatch(/\?::uuid, true,/);
    expect(events.record).toHaveBeenCalledWith(
      DOMAIN_EVENTS.DOCUMENT_ELIGIBILITY_MISMATCH,
      expect.objectContaining({
        fields: [{ field: 'category', sensitive: false, source: 'recorded' }],
      }),
    );
  });
});
