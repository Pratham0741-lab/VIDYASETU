# Migration V2 Architecture & Revision Changelog

This document details the major architectural revisions and hardening applied to the **MoTA Scholarship Portal** database and application layers (Smart India Hackathon project), based on external code review findings.

---

## 1. Evaluation of External Code Review Findings

### ❌ False Positives Addressed (No Duplicate Actions Taken)

1. **Reviewer Claim: *"pgcrypto extension is never created"***
   - **Status: FALSE POSITIVE.**
   - **Reason**: The extension is explicitly created on line 10 of the initial migration (`20260926000000_init_scheme_schema/migration.sql`):
     ```sql
     CREATE EXTENSION IF NOT EXISTS pgcrypto;
     ```
   - **Action**: Confirmed that migrations execute in chronological order. No duplicate extension statement added.

2. **Reviewer Claim: *"Nothing stops UPDATE applications SET scheme_version_id"***
   - **Status: FALSE POSITIVE.**
   - **Reason**: The immutability of `applications.scheme_version_id` is enforced by the database trigger `trigger_prevent_scheme_version_change` executing function `prevent_scheme_version_change()` defined in the initial migration:
     ```sql
     IF NEW.scheme_version_id IS DISTINCT FROM OLD.scheme_version_id THEN
       RAISE EXCEPTION 'scheme_version_id on applications is immutable once set...';
     END IF;
     ```
   - **Action**: Verified and preserved; not duplicated.

---

## 2. Core Architectural Decisions (For Confirmation)

1. **Predicate/Rule-List Config Schema (`schemas/scheme-config.schema.json`)**:
   - **Decision**: Replaced flat descriptive JSON with an evaluable array of rule predicates (`rules[]`) and decomposed entitlements (`benefits[]`).
   - **Rationale**: Directly powers the Phase 4 rules engine and "zero-code" dynamic scheme creation demo by enabling programmatic evaluation (`expr: "applicant.family_income_annual <= params.income_ceiling"`).
   - **Single-Sourced**: Defined once canonically in `schemas/scheme-config.schema.json`, validated by `Ajv` in `prisma/seed.ts`, and enforced in PostgreSQL via `check_scheme_versions_config_schema` using `json_matches_schema` (or `is_valid_scheme_config` fallback).

2. **Supabase Auth + PostgREST Assumption**:
   - **Decision**: Maintained `request.jwt.claim.sub` and `request.jwt.claim.role` for audit actor identification and `auth.uid()` for RLS policies.
   - **Verification**: PostgREST and Supabase automatically inject these session settings for client requests. Added `request.header.x-forwarded-for` extraction for caller IP tracking.
   - *Note*: If the project transitions to a custom NestJS backend connecting directly via Prisma pooling, session variables must instead be set via PostgreSQL transaction variables (`SET LOCAL`).

3. **Application-Layer PII Encryption (AES-256-GCM)**:
   - **Decision**: Shifted sensitive PII storage encryption (`caste_cert_number`, `income`, `bank_account`) from database-side `pgcrypto` to application-layer Node.js `crypto` with a Prisma Client Extension (`$extends`).
   - **Rationale**:
     - **Key Isolation**: Secret key is stored strictly in application environment (`PII_ENCRYPTION_KEY`), preventing database administrators or compromised backups from reading plaintext PII.
     - **Prisma Developer Experience**: Eliminates the need for raw SQL queries (`$queryRaw` / `$executeRaw`). Developers use normal `prisma.applicant.create()` and `prisma.applicant.findUnique()` with transparent encryption and decryption.
     - **Backward Compatibility**: `encrypt_pii` and `decrypt_pii` functions remain in PostgreSQL but are marked `DEPRECATED`.

---

## 3. Summary of Applied Changes

| Task | Component | Description |
|:---|:---|:---|
| **Task 1** | `schemas/scheme-config.schema.json` | Canonical schema for predicate-based configs (`rules`, `benefits`, `required_documents`, `fund_sharing_ratio`). |
| **Task 1** | `scripts/migrate-config-to-predicates.ts` | Node/TS script migrating all 15 versions across 5 schemes with zero data loss. |
| **Task 1** | `scheme_versions_seed_v2.json` | Complete transformed seed dataset for all 15 scheme versions. |
| **Task 2** | `migration.sql` (Task 2) | Trigger `prevent_locked_scheme_version_update` preventing edits to `scheme_versions.config` once referenced by live applications. Draft/unreferenced versions remain editable. |
| **Task 3** | `migration.sql` (Task 3) | Hardened `audit_logs`: revoked `UPDATE` and `DELETE` from `PUBLIC`, `app_user`, `authenticated`, and `anon`. |
| **Task 3** | `migration.sql` (Task 3) | Added IP address tracking via `request.header.x-forwarded-for` and `request.headers`. |
| **Task 3** | `migration.sql` (Task 3) | Expanded audit hash-chain triggers to cover 6 additional tables: `selections`, `scheme_versions`, `workflow_transitions`, `deficiencies`, `renewals`, `scores` (10 tables total). |
| **Task 4** | `lib/crypto/pii.ts` | AES-256-GCM encryption/decryption utilities using 12-byte IV and 16-byte AuthTag prepended to ciphertext. |
| **Task 4** | `lib/crypto/pii-extension.ts` | Prisma Client Extension (`piiEncryptionExtension`) intercepting `Applicant` queries to transparently encrypt writes and decrypt reads. |
| **Task 4** | `scripts/generate-pii-key.ts` | Utility generating a cryptographically random 32-byte base64-encoded key. |
| **Task 5** | `prisma/seed.ts` | Updated to load `scheme_versions_seed_v2.json`, validate against `schemas/scheme-config.schema.json`, wrap execution in `prisma.$transaction`, and gracefully skip frozen versions. |
| **Task 5** | `scripts/demo-pii-roundtrip.ts` | Demonstrates round-trip encryption/decryption using the extended Prisma Client. |
| **Task 6** | `migration.sql` (Task 6) | Enforced `SET search_path = public, pg_temp` on all `SECURITY DEFINER` functions (`process_audit_log_hash_chain`, `encrypt_pii`, `decrypt_pii`). |
| **Task 7** | `scheme_versions_seed_v2.json` | Set `metadata.data_verified: false` across all 15 scheme versions. |

---

## 4. Unmapped Fields Audit

During the execution of `scripts/migrate-config-to-predicates.ts`, every existing field from `scheme_versions_seed.json` was audited:
- **Total versions processed**: 15
- **Total unmapped fields**: **0**
- All scheme-specific variations (such as JRF/SRF tiers in NFST, QS university ranking rules and foreign currency maintenance in NOS, adhoc book grants in Pre-Matric, and computer/laptop hardware grants in Top Class) were mapped to either `benefits[]` or `rules[]` (`benefit_note` or `operational`).

---

## 5. Required Manual Setup Steps

### 1. Generate & Set `PII_ENCRYPTION_KEY`
Run the key generation script once per environment:
```bash
npx tsx scripts/generate-pii-key.ts
```
Add the generated key to your `.env` file:
```env
PII_ENCRYPTION_KEY="<base64-32-byte-key>"
```

### 2. Verify Data Flags (`data_verified`)
All 15 versions in `scheme_versions_seed_v2.json` currently have:
```json
"metadata": {
  "data_verified": false
}
```
**Manual verification step**: A team member must cross-check the numbers against the actual guidelines PDFs in the `TopClass/`, `NOS/`, `NFST/`, `PreMatric/`, and `PostMatric/` folders, and flip `data_verified` to `true` on audited records.
