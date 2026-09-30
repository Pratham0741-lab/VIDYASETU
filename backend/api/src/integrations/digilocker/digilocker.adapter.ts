import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { CanonicalDocumentType } from '../../documents/document-types';
import { AdapterAvailability, IntegrationAdapter, notConfigured } from '../integration-adapter';

/** An issued document DigiLocker vouches for (the issuer's own record). */
export interface DigiLockerDocument {
  /** The DigiLocker document URI the applicant shared. */
  reference: string;
  document_type: CanonicalDocumentType;
  issuer: string;
  issuer_id: string;
  issued_at: string; // YYYY-MM-DD
  verified_at: string; // ISO: when DigiLocker confirmed it for us
  holder_name: string;
  /**
   * Structured data, keyed with the same field names Phase 7's extractors use
   * for the type, so the consistency and eligibility checks read it alike.
   * May carry sensitive values (income, caste certificate number): the
   * caller stores them the Phase 7 way (encrypted, marker in extracted_data).
   */
  data: Record<string, unknown>;
  /** The issued document itself (DigiLocker returns the issuer's XML). */
  file: { name: string; mime_type: string; content: Buffer };
}

export type DigiLockerVerification =
  | { status: 'VERIFIED'; document: DigiLockerDocument }
  /** No issued document with this reference (or not linked to any DigiLocker account). */
  | { status: 'NOT_FOUND'; reference: string }
  /** The document exists but its holder has not granted VIDYASETU access to it. */
  | { status: 'CONSENT_NOT_GRANTED'; reference: string; issuer: string };

export abstract class DigiLockerAdapter implements IntegrationAdapter {
  readonly service = 'digilocker';
  abstract checkAvailability(): Promise<AdapterAvailability>;
  abstract verifyDocument(reference: string): Promise<DigiLockerVerification>;
}

// ---------------------------------------------------------------------------
// MOCK: an in-process registry of issued documents. Nothing leaves the
// process; the XML carries no real digital signature and says so.
// ---------------------------------------------------------------------------
interface MockRecord {
  document_type: CanonicalDocumentType;
  doc_code: string;
  name: string;
  issuer: string;
  issuer_id: string;
  issued_at: string;
  holder_name: string;
  consent_granted: boolean;
  data: Record<string, unknown>;
}

const JH_EDISTRICT =
  'Revenue, Registration & Land Reforms Dept., Government of Jharkhand (e-District)';

export const MOCK_DIGILOCKER_RECORDS: Readonly<Record<string, MockRecord>> = {
  // A genuinely verified income certificate.
  'in.gov.jharkhand.edistrict-INCER-JH2026000451': {
    document_type: 'INCOME_CERTIFICATE',
    doc_code: 'INCER',
    name: 'Income Certificate',
    issuer: JH_EDISTRICT,
    issuer_id: 'in.gov.jharkhand.edistrict',
    issued_at: '2026-04-02',
    holder_name: 'Kavya Oraon',
    consent_granted: true,
    data: {
      applicant_name: 'Kavya Oraon',
      family_income_annual: 180000,
      certificate_number: 'JH-INC-2026-000451',
      issued_date: '2026-04-02',
    },
  },
  // A verified caste certificate for the same holder.
  'in.gov.jharkhand.edistrict-CASTE-JH2026000452': {
    document_type: 'CASTE_CERTIFICATE',
    doc_code: 'CASTE',
    name: 'Caste Certificate',
    issuer: JH_EDISTRICT,
    issuer_id: 'in.gov.jharkhand.edistrict',
    issued_at: '2026-03-18',
    holder_name: 'Kavya Oraon',
    consent_granted: true,
    data: {
      applicant_name: 'Kavya Oraon',
      category: 'ST',
      caste_cert_number: 'JH-ST-2026-000452',
      issued_date: '2026-03-18',
    },
  },
  // A verified income certificate whose income disagrees with a declaration
  // (exercises the eligibility cross-check on the DigiLocker path).
  'in.gov.jharkhand.edistrict-INCER-JH2026000777': {
    document_type: 'INCOME_CERTIFICATE',
    doc_code: 'INCER',
    name: 'Income Certificate',
    issuer: JH_EDISTRICT,
    issuer_id: 'in.gov.jharkhand.edistrict',
    issued_at: '2026-04-11',
    holder_name: 'Ravi Munda',
    consent_granted: true,
    data: {
      applicant_name: 'Ravi Munda',
      family_income_annual: 420000,
      certificate_number: 'JH-INC-2026-000777',
      issued_date: '2026-04-11',
    },
  },
  // Exists, but the holder has not granted consent to VIDYASETU.
  'in.gov.jharkhand.edistrict-CASTE-JH2026000999': {
    document_type: 'CASTE_CERTIFICATE',
    doc_code: 'CASTE',
    name: 'Caste Certificate',
    issuer: JH_EDISTRICT,
    issuer_id: 'in.gov.jharkhand.edistrict',
    issued_at: '2026-02-09',
    holder_name: 'Kavya Oraon',
    consent_granted: false,
    data: {},
  },
};

@Injectable()
export class MockDigiLockerAdapter extends DigiLockerAdapter {
  constructor(@InjectPinoLogger('MockDigiLockerAdapter') private readonly logger: PinoLogger) {
    super();
  }

  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: true, mode: 'mock' });
  }

  verifyDocument(reference: string): Promise<DigiLockerVerification> {
    const r = Object.prototype.hasOwnProperty.call(MOCK_DIGILOCKER_RECORDS, reference)
      ? MOCK_DIGILOCKER_RECORDS[reference]
      : undefined;
    this.logger.info(
      { digilocker: { reference, found: !!r, consent: r?.consent_granted ?? null } },
      'MOCK DigiLocker lookup (in-process registry)',
    );
    if (!r) return Promise.resolve({ status: 'NOT_FOUND', reference });
    if (!r.consent_granted) {
      return Promise.resolve({ status: 'CONSENT_NOT_GRANTED', reference, issuer: r.issuer });
    }
    return Promise.resolve({
      status: 'VERIFIED',
      document: {
        reference,
        document_type: r.document_type,
        issuer: r.issuer,
        issuer_id: r.issuer_id,
        issued_at: r.issued_at,
        verified_at: new Date().toISOString(),
        holder_name: r.holder_name,
        data: { ...r.data },
        file: {
          name: `${reference}.xml`,
          mime_type: 'application/xml',
          content: Buffer.from(issuedXml(reference, r), 'utf8'),
        },
      },
    });
  }
}

const xmlEscape = (v: unknown) => String(v).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The issued-document XML, in DigiLocker's certificate layout (mock: unsigned). */
function issuedXml(reference: string, r: MockRecord): string {
  const fields = Object.entries(r.data)
    .map(([k, v]) => `    <Field name="${xmlEscape(k)}">${xmlEscape(v)}</Field>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Certificate uri="${xmlEscape(reference)}" type="${r.doc_code}" name="${xmlEscape(r.name)}" issueDate="${r.issued_at}" status="A">`,
    `  <IssuedBy><Organization name="${xmlEscape(r.issuer)}" code="${xmlEscape(r.issuer_id)}"/></IssuedBy>`,
    `  <IssuedTo><Person name="${xmlEscape(r.holder_name)}"/></IssuedTo>`,
    '  <CertificateData>',
    fields,
    '  </CertificateData>',
    '  <Signature>MOCK DIGILOCKER DOCUMENT - no digital signature, not a real issued document</Signature>',
    '</Certificate>',
    '',
  ].join('\n');
}

/** DIGILOCKER_MODE=real: not configured in this build (fails closed). */
@Injectable()
export class UnconfiguredDigiLockerAdapter extends DigiLockerAdapter {
  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: false, mode: 'real' });
  }
  verifyDocument(): Promise<DigiLockerVerification> {
    return Promise.reject(notConfigured(this.service));
  }
}
