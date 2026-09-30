import { Injectable } from '@nestjs/common';
import { DbContext } from '../database/db-context';
import { decryptPII } from '../lib/crypto/pii';
import type { AppFacts, ApplicantIdentity, DocFacts, FraudData, IndexEntry } from './detectors';
import type { MatchField } from './fraud-match';

/**
 * The live FraudData: every call runs inside the SYSTEM transaction the
 * detection service opens (DbContext.client is that transaction).
 *   - applications / documents of every jurisdiction come only through the
 *     SYSTEM-only fraud_*_facts functions (ids and minimal facts);
 *   - an applicant's own encrypted identifiers are decrypted in memory by the
 *     Phase 1 PII extension, turned into a keyed hash, and dropped - never
 *     logged, never stored, never returned;
 *   - other applicants are matched through pii_match_index only.
 */
@Injectable()
export class PrismaFraudData implements FraudData {
  constructor(private readonly db: DbContext) {}

  async applications(q: {
    applicationIds?: string[];
    applicantIds?: string[];
    institutionCode?: string;
    disbursementIds?: string[];
  }): Promise<AppFacts[]> {
    return this.db.client.$queryRaw<AppFacts[]>`SELECT * FROM fraud_application_facts(
      ${q.applicationIds ?? null}::uuid[], ${q.applicantIds ?? null}::uuid[],
      ${q.institutionCode ?? null}::text, ${q.disbursementIds ?? null}::uuid[])`;
  }

  async documents(q: {
    documentIds?: string[];
    applicationId?: string;
    fileSha256?: string;
  }): Promise<DocFacts[]> {
    return this.db.client.$queryRaw<DocFacts[]>`SELECT * FROM fraud_document_facts(
      ${q.documentIds ?? null}::uuid[], ${q.applicationId ?? null}::uuid, ${q.fileSha256 ?? null}::text)`;
  }

  async declaredIdentifiers(applicantId: string) {
    const a = (await this.db.client.applicant.findUnique({
      where: { id: applicantId },
      select: { bank_account: true, caste_cert_number: true },
    })) as unknown as { bank_account: string | null; caste_cert_number: string | null } | null;
    return {
      bank_account: a?.bank_account ?? null,
      caste_cert_number: a?.caste_cert_number ?? null,
    };
  }

  async extractedIdentifiers(applicationId: string) {
    const rows = await this.db.client.documentExtraction.findMany({
      where: { application_id: applicationId, status: 'COMPLETED' },
      select: {
        document_id: true,
        extracted_data: true,
        sensitive_values: true,
        extraction_engine: true,
      },
    });
    const out: Array<{
      document_id: string;
      field: MatchField;
      value: string;
      source: 'OCR' | 'DIGILOCKER';
    }> = [];
    for (const r of rows) {
      const source = r.extraction_engine === 'DIGILOCKER' ? 'DIGILOCKER' : 'OCR';
      const data = r.extracted_data as Record<string, unknown>;
      // Sensitive values live only in the encrypted sensitive_values (since
      // Phase 11.5 that includes certificate_number); decrypted in memory.
      const sensitive = r.sensitive_values
        ? (JSON.parse(decryptPII(r.sensitive_values)) as Record<string, unknown>)
        : {};
      // An extraction written before Phase 11.5 and not yet backfilled
      // still holds certificate_number as text in extracted_data.
      const certificate = sensitive.certificate_number ?? data.certificate_number;
      if (typeof certificate === 'string') {
        out.push({
          document_id: r.document_id,
          field: 'certificate_number',
          value: certificate,
          source,
        });
      }
      if (typeof sensitive.caste_cert_number === 'string') {
        out.push({
          document_id: r.document_id,
          field: 'caste_cert_number',
          value: sensitive.caste_cert_number,
          source,
        });
      }
    }
    return out;
  }

  async upsertIndex(entries: IndexEntry[]): Promise<void> {
    for (const e of entries) {
      if (e.document_id === null) {
        await this.db.client.$executeRaw`
          INSERT INTO pii_match_index (applicant_id, field, source, document_id, match_hmac)
          VALUES (${e.applicant_id}::uuid, ${e.field}, ${e.source}, NULL, ${e.match_hmac})
          ON CONFLICT (applicant_id, field) WHERE document_id IS NULL
          DO UPDATE SET match_hmac = EXCLUDED.match_hmac, source = EXCLUDED.source, indexed_at = CURRENT_TIMESTAMP`;
      } else {
        await this.db.client.$executeRaw`
          INSERT INTO pii_match_index (applicant_id, field, source, document_id, match_hmac)
          VALUES (${e.applicant_id}::uuid, ${e.field}, ${e.source}, ${e.document_id}::uuid, ${e.match_hmac})
          ON CONFLICT (document_id, field) WHERE document_id IS NOT NULL
          DO UPDATE SET match_hmac = EXCLUDED.match_hmac, source = EXCLUDED.source, indexed_at = CURRENT_TIMESTAMP`;
      }
    }
  }

  async findIndexMatches(field: MatchField, hmac: string): Promise<IndexEntry[]> {
    const rows = await this.db.client.piiMatchIndex.findMany({
      where: { field, match_hmac: hmac },
      select: {
        applicant_id: true,
        field: true,
        source: true,
        document_id: true,
        match_hmac: true,
      },
    });
    return rows as IndexEntry[];
  }

  async identity(applicantId: string): Promise<ApplicantIdentity | null> {
    const a = await this.db.client.applicant.findUnique({
      where: { id: applicantId },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        dob: true,
        domicile_state: true,
        domicile_district: true,
      },
    });
    return a ? toIdentity(a) : null;
  }

  async identityCandidates(
    domicileState: string,
    excludeApplicantId: string,
  ): Promise<ApplicantIdentity[]> {
    const rows = await this.db.client.applicant.findMany({
      where: { domicile_state: domicileState, id: { not: excludeApplicantId }, dob: { not: null } },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        dob: true,
        domicile_state: true,
        domicile_district: true,
      },
    });
    return rows.map(toIdentity);
  }

  async platformFirstSubmission(): Promise<Date | null> {
    const [row] = await this.db.client.$queryRaw<Array<{ first: Date | null }>>`
      SELECT fraud_platform_first_submission() AS first`;
    return row?.first ?? null;
  }
}

function toIdentity(a: {
  id: string;
  first_name: string;
  last_name: string;
  dob: Date | null;
  domicile_state: string;
  domicile_district: string | null;
}): ApplicantIdentity {
  return {
    applicant_id: a.id,
    first_name: a.first_name,
    last_name: a.last_name,
    dob: a.dob ? a.dob.toISOString().slice(0, 10) : null,
    domicile_state: a.domicile_state,
    domicile_district: a.domicile_district,
  };
}
