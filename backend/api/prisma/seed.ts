import { PrismaClient } from '@prisma/client';
import Ajv from 'ajv';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const ajv = new Ajv({ allErrors: true });

// ============================================================================
// TASK 1 (Req 4): SINGLE-SOURCED Schema Definition from schemas/scheme-config.schema.json
// ============================================================================
function loadCanonicalSchema() {
  const candidateSchemaPaths = [
    path.resolve(process.cwd(), 'schemas/scheme-config.schema.json'),
    path.resolve(__dirname, '../schemas/scheme-config.schema.json'),
  ];

  for (const p of candidateSchemaPaths) {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  }

  throw new Error(
    `[SEED ERROR] Could not find canonical schema at "schemas/scheme-config.schema.json". Attempted:\n` +
      candidateSchemaPaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n')
  );
}

const canonicalConfigSchema = loadCanonicalSchema();
const validateConfig = ajv.compile(canonicalConfigSchema);

// ============================================================================
// Parent Schemes Seed Data
// ============================================================================
interface SchemeDefinition {
  code: string;
  name: string;
  department: string;
  description: string;
  type: string;
  portal_url: string;
  is_active: boolean;
  /**
   * Who pays the student (Phase 12, decision D2 on M16): SCHEDULED_BY_PLATFORM
   * (instalments scheduled here and sent to PFMS) or FORWARDED_TO_STATE (the
   * State disburses by DBT; the platform schedules nothing).
   */
  disbursement_mode: 'SCHEDULED_BY_PLATFORM' | 'FORWARDED_TO_STATE';
}

const parentSchemes: SchemeDefinition[] = [
  {
    code: 'PRE_MATRIC',
    name: 'Pre-Matric Scholarship for ST Students (Classes IX & X)',
    department: 'Scholarship Division, Ministry of Tribal Affairs',
    description:
      'Centrally sponsored scheme providing financial support to Scheduled Tribe students studying in classes IX and X to minimize dropouts and build foundation for secondary education.',
    type: 'CENTRALLY_SPONSORED',
    portal_url: 'https://tribal.nic.in/ScholarshiP.aspx',
    is_active: true,
    // Not covered by decision D2: unchanged behaviour (KNOWN_LIMITATIONS M22).
    disbursement_mode: 'SCHEDULED_BY_PLATFORM',
  },
  {
    code: 'POST_MATRIC',
    name: 'Post-Matric Scholarship for ST Students',
    department: 'Scholarship Division, Ministry of Tribal Affairs',
    description:
      'Centrally sponsored scheme providing comprehensive financial assistance to Scheduled Tribe students pursuing recognized post-matriculation and post-secondary educational programs.',
    type: 'CENTRALLY_SPONSORED',
    portal_url: 'https://tribal.nic.in/ScholarshiP.aspx',
    is_active: true,
    disbursement_mode: 'FORWARDED_TO_STATE',
  },
  {
    code: 'TOP_CLASS',
    name: 'National Scholarship Scheme for Higher Education of ST Students (Top Class Education)',
    department: 'Scholarship Division, Ministry of Tribal Affairs',
    description:
      'Central sector scholarship scheme financing graduate and postgraduate degrees for meritorious ST students admitted into 250+ premier notified institutions (IITs, IIMs, NITs, AIIMS, NLUs, etc.).',
    type: 'CENTRAL_SECTOR',
    portal_url: 'https://tribal.nic.in/ScholarshiP.aspx',
    is_active: true,
    disbursement_mode: 'SCHEDULED_BY_PLATFORM',
  },
  {
    code: 'NFST',
    name: 'National Fellowship for Higher Education of ST Students',
    department: 'Fellowship Division, Ministry of Tribal Affairs',
    description:
      'Central sector fellowship providing 750 annual slots to Scheduled Tribe students for pursuing regular, full-time M.Phil. and Ph.D. research programs in recognized Indian universities and institutes.',
    type: 'CENTRAL_SECTOR',
    portal_url: 'https://fellowship.tribal.gov.in',
    is_active: true,
    disbursement_mode: 'SCHEDULED_BY_PLATFORM',
  },
  {
    code: 'NOS',
    name: 'National Overseas Scholarship for Scheduled Tribe Candidates',
    department: 'Overseas Division, Ministry of Tribal Affairs',
    description:
      'Central sector scheme providing 20 slots annually for meritorious Scheduled Tribe candidates to pursue Master level courses and Ph.D. research degrees in accredited universities abroad.',
    type: 'CENTRAL_SECTOR',
    portal_url: 'https://overseas.tribal.gov.in',
    is_active: true,
    // Not covered by decision D2: unchanged behaviour.
    disbursement_mode: 'SCHEDULED_BY_PLATFORM',
  },
];

interface RawSchemeVersionEntryV2 {
  scheme_code: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  config: Record<string, any>;
  source_document?: string;
  source_url?: string;
  extraction_confidence?: string;
  extraction_notes?: string;
}

// ============================================================================
// Resilient Seed File Path Resolver (Task 1 & Task 5: Loads V2 Predicate Seeds)
// ============================================================================
function resolveSeedFilePath(): string {
  const candidatePaths = [
    path.resolve(process.cwd(), 'prisma/scheme_versions_seed_v2.json'),
    path.resolve(__dirname, 'scheme_versions_seed_v2.json'),
  ];

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `[SEED ERROR] Could not locate "scheme_versions_seed_v2.json". Attempted the following candidate paths:\n` +
      candidatePaths.map((p, idx) => `  ${idx + 1}. ${p}`).join('\n') +
      `\nprisma/scheme_versions_seed_v2.json is the canonical, hand-maintained seed file; restore it from version control.`
  );
}

// ============================================================================
// Main Seed Function wrapped in Atomic Transaction (Task 5)
// ============================================================================
async function main() {
  console.log('============================================================');
  console.log('🌱 Starting Atomic Database Seeding: MoTA Scholarship Schemes (V2)');
  console.log('============================================================\n');

  // Load and parse scheme_versions_seed_v2.json
  const seedFilePath = resolveSeedFilePath();
  console.log(`📄 Step 1: Loading V2 Predicate Seed File: ${seedFilePath}`);
  const rawData = fs.readFileSync(seedFilePath, 'utf-8');
  const entries: RawSchemeVersionEntryV2[] = JSON.parse(rawData);
  console.log(`   Found ${entries.length} scheme version entries in seed dataset.\n`);

  // Execute entire seeding inside a single atomic transaction
  await prisma.$transaction(async (tx) => {
    // Step 2: Upsert Parent Schemes
    console.log('📦 Step 2: Upserting 5 Parent Schemes...');
    const schemeMap = new Map<string, string>(); // code -> id

    for (const schemeData of parentSchemes) {
      const upsertedScheme = await tx.scheme.upsert({
        where: { code: schemeData.code },
        update: {
          name: schemeData.name,
          department: schemeData.department,
          description: schemeData.description,
          type: schemeData.type,
          portal_url: schemeData.portal_url,
          is_active: schemeData.is_active,
          disbursement_mode: schemeData.disbursement_mode,
        },
        create: {
          code: schemeData.code,
          name: schemeData.name,
          department: schemeData.department,
          description: schemeData.description,
          type: schemeData.type,
          portal_url: schemeData.portal_url,
          is_active: schemeData.is_active,
          disbursement_mode: schemeData.disbursement_mode,
        },
      });

      schemeMap.set(upsertedScheme.code, upsertedScheme.id);
      console.log(`  ✓ Scheme [${upsertedScheme.code}]: ${upsertedScheme.name} (ID: ${upsertedScheme.id})`);
    }

    // Step 3: Validate and Seed Scheme Versions with Immutability Protection (Task 2 & 5)
    console.log('\n🔍 Step 3: Validating and Seeding Scheme Versions (with immutability safeguards)...');
    let successCount = 0;
    let skippedFrozenCount = 0;
    let validationFailedCount = 0;

    for (const entry of entries) {
      const schemeId = schemeMap.get(entry.scheme_code);

      if (!schemeId) {
        console.warn(
          `  ⚠️  [SKIPPED] Unrecognized scheme_code "${entry.scheme_code}" in version ${entry.version_no}.`
        );
        continue;
      }

      // 1. Schema Validation against canonical single-sourced schema
      const isValid = validateConfig(entry.config);
      if (!isValid) {
        console.warn(
          `  ⚠️  [VALIDATION WARNING] Config validation failed for Scheme ${entry.scheme_code} Version ${entry.version_no}.`,
          'Errors:',
          JSON.stringify(validateConfig.errors, null, 2)
        );
        validationFailedCount++;
        continue;
      }

      const status = entry.effective_to !== null && entry.effective_to !== undefined ? 'archived' : 'active';
      const fromDate = new Date(entry.effective_from);
      const toDate = entry.effective_to ? new Date(entry.effective_to) : null;

      // 2. Immutability Check: Inspect if version is already referenced by live applications
      const existingVersion = await tx.schemeVersion.findUnique({
        where: {
          scheme_id_version_no: {
            scheme_id: schemeId,
            version_no: entry.version_no,
          },
        },
        include: {
          _count: {
            select: { applications: true },
          },
        },
      });

      if (existingVersion) {
        if (existingVersion._count.applications > 0) {
          console.log(
            `  🔒 [FROZEN SKIP] ${entry.scheme_code} v${entry.version_no} is referenced by ${existingVersion._count.applications} application(s). Skipping update to preserve immutability.`
          );
          skippedFrozenCount++;
          // Lifecycle only (never config): a frozen version can still be
          // retired when a newer one supersedes it. The DB immutability
          // trigger locks config alone and permits exactly this.
          const retire =
            existingVersion.status !== status ||
            (existingVersion.effective_to?.getTime() ?? null) !== (toDate?.getTime() ?? null);
          if (retire) {
            await tx.schemeVersion.update({
              where: { id: existingVersion.id },
              data: { effective_to: toDate, status },
            });
            console.log(
              `  📅 [LIFECYCLE] ${entry.scheme_code} v${entry.version_no}: status=${status}, effective_to=${entry.effective_to ?? 'none'} (config untouched)`
            );
          }
          continue;
        }

        // Safe to update unreferenced/draft version
        try {
          const updated = await tx.schemeVersion.update({
            where: { id: existingVersion.id },
            data: {
              effective_from: fromDate,
              effective_to: toDate,
              status,
              config: entry.config,
              source_document: entry.source_document ?? null,
              source_url: entry.source_url ?? null,
              extraction_confidence: entry.extraction_confidence ?? null,
              extraction_notes: entry.extraction_notes ?? null,
            },
          });
          console.log(`  ✓ Updated draft version: ${entry.scheme_code} v${entry.version_no} (ID: ${updated.id})`);
          successCount++;
        } catch (err: any) {
          if (err.message && err.message.includes('prevent_locked_scheme_version_update')) {
            console.log(
              `  🔒 [TRIGGER BLOCKED] ${entry.scheme_code} v${entry.version_no} rejected by DB immutability trigger: ${err.message}`
            );
            skippedFrozenCount++;
          } else {
            throw err;
          }
        }
      } else {
        // Safe to create new version
        const created = await tx.schemeVersion.create({
          data: {
            scheme_id: schemeId,
            version_no: entry.version_no,
            effective_from: fromDate,
            effective_to: toDate,
            status,
            config: entry.config,
            source_document: entry.source_document ?? null,
            source_url: entry.source_url ?? null,
            extraction_confidence: entry.extraction_confidence ?? null,
            extraction_notes: entry.extraction_notes ?? null,
          },
        });
        console.log(`  ✓ Created new version: ${entry.scheme_code} v${entry.version_no} (ID: ${created.id})`);
        successCount++;
      }
    }

    console.log('\n============================================================');
    console.log(`✨ Transactional Seeding Complete!`);
    console.log(`  - Parent Schemes Processed : ${parentSchemes.length}`);
    console.log(`  - Scheme Versions Seeded   : ${successCount}`);
    console.log(`  - Frozen Versions Skipped  : ${skippedFrozenCount}`);
    console.log(`  - Validation Failures      : ${validationFailedCount}`);
    console.log('============================================================\n');
  });
}

main()
  .catch((e) => {
    console.error('❌ Error executing database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
