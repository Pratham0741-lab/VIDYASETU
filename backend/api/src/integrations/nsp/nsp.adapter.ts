import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AdapterAvailability, IntegrationAdapter, notConfigured } from '../integration-adapter';

/**
 * The identity fields the NSP duplicate check matches on. Deliberately
 * limited to non-sensitive applicant columns (plain text / date in the
 * database): no decryption is needed, and nothing on Phase 3's sensitive
 * list (income, caste certificate number, bank account) is ever sent.
 * NSP's own de-duplication keys on Aadhaar, which VIDYASETU does not hold
 * (Phase 10 finding 2), so a name + date-of-birth match is a lead for a
 * reviewer, never proof.
 */
export interface NspIdentityFields {
  full_name: string;
  dob: string; // YYYY-MM-DD
  gender: string | null;
}

export interface NspScholarshipMatch {
  nsp_application_id: string;
  scheme: string;
  academic_year: string;
  state: string;
  status: 'SANCTIONED' | 'PAID' | 'UNDER_VERIFICATION';
  /** Which fields matched. name + dob are required for any match. */
  matched_on: string[];
  gender_matches: boolean | null;
}

export interface NspDuplicateCheckResult {
  duplicate_found: boolean;
  matches: NspScholarshipMatch[];
  checked_on: string[];
  checked_at: string;
}

export abstract class NspAdapter implements IntegrationAdapter {
  readonly service = 'nsp';
  abstract checkAvailability(): Promise<AdapterAvailability>;
  abstract checkDuplicateScholarship(fields: NspIdentityFields): Promise<NspDuplicateCheckResult>;
}

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'shri', 'shree', 'smt', 'kumari', 'km', 'dr']);

/** Case, spacing, punctuation, honorific and word-order insensitive name key. */
export function nameKey(name: string): string {
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && TITLES.has(tokens[0])) tokens.shift();
  return [...tokens].sort().join(' ');
}

interface MockNspRecord {
  nsp_application_id: string;
  name: string;
  dob: string;
  gender: string;
  scheme: string;
  academic_year: string;
  state: string;
  status: NspScholarshipMatch['status'];
}

/** MOCK: a small seeded extract of "existing NSP scholarship records". */
export const MOCK_NSP_RECORDS: readonly MockNspRecord[] = [
  {
    nsp_application_id: 'OD2026-PMS-ST-0048817',
    name: 'Rekha Minz',
    dob: '2003-08-21',
    gender: 'FEMALE',
    scheme: 'Post Matric Scholarship for ST Students (Odisha)',
    academic_year: '2026-27',
    state: 'Odisha',
    status: 'SANCTIONED',
  },
  {
    nsp_application_id: 'JH2025-PMS-ST-0112903',
    name: 'MINZ, Rekha',
    dob: '2003-08-21',
    gender: 'FEMALE',
    scheme: 'Post Matric Scholarship for ST Students (Jharkhand)',
    academic_year: '2025-26',
    state: 'Jharkhand',
    status: 'PAID',
  },
  {
    // Same name, different person (different date of birth): must NOT match.
    nsp_application_id: 'CG2026-PMS-ST-0007731',
    name: 'Rekha Minz',
    dob: '2001-01-05',
    gender: 'FEMALE',
    scheme: 'Post Matric Scholarship for ST Students (Chhattisgarh)',
    academic_year: '2026-27',
    state: 'Chhattisgarh',
    status: 'UNDER_VERIFICATION',
  },
  {
    nsp_application_id: 'JH2026-TCS-ST-0000412',
    name: 'Arjun Tudu',
    dob: '2001-11-30',
    gender: 'MALE',
    scheme: 'Top Class Education for ST Students',
    academic_year: '2026-27',
    state: 'Jharkhand',
    status: 'SANCTIONED',
  },
];

@Injectable()
export class MockNspAdapter extends NspAdapter {
  constructor(@InjectPinoLogger('MockNspAdapter') private readonly logger: PinoLogger) {
    super();
  }

  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: true, mode: 'mock' });
  }

  checkDuplicateScholarship(fields: NspIdentityFields): Promise<NspDuplicateCheckResult> {
    const key = nameKey(fields.full_name);
    const matches = MOCK_NSP_RECORDS.filter(
      (r) => nameKey(r.name) === key && r.dob === fields.dob,
    ).map((r): NspScholarshipMatch => ({
      nsp_application_id: r.nsp_application_id,
      scheme: r.scheme,
      academic_year: r.academic_year,
      state: r.state,
      status: r.status,
      matched_on: ['name', 'dob'],
      gender_matches: fields.gender === null ? null : r.gender === fields.gender,
    }));
    this.logger.info(
      { nsp: { matches: matches.length } },
      'MOCK NSP duplicate check (seeded records)',
    );
    return Promise.resolve({
      duplicate_found: matches.length > 0,
      matches,
      checked_on: ['name', 'dob', 'gender'],
      checked_at: new Date().toISOString(),
    });
  }
}

/** NSP_MODE=real: not configured in this build (fails closed). */
@Injectable()
export class UnconfiguredNspAdapter extends NspAdapter {
  checkAvailability(): Promise<AdapterAvailability> {
    return Promise.resolve({ available: false, mode: 'real' });
  }
  checkDuplicateScholarship(): Promise<NspDuplicateCheckResult> {
    return Promise.reject(notConfigured(this.service));
  }
}
