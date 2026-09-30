import re
p = 'prisma/schema.prisma'
s = open(p, encoding='utf8').read()


def blk(model):
    k = s.index('model %s {' % model)
    e = s.index('\n}', k)
    return k, e


def add_before_first_index(model, text):
    global s
    k, e = blk(model)
    b = s[k:e]
    i = b.index('\n  @@')
    b = b[:i] + '\n' + text.rstrip('\n') + '\n' + b[i:]
    s = s[:k] + b + s[e:]


def add_line_after(model, pattern, text):
    global s
    k, e = blk(model)
    b = s[k:e]
    b2 = re.sub(pattern, lambda m: m.group(0) + text, b, count=1)
    assert b2 != b, (model, pattern)
    s = s[:k] + b2 + s[e:]


add_before_first_index('Selection', """  // Phase 9: confirmation (MINISTRY_OFFICER) and objection-window override.
  confirmed_at                DateTime?        @db.Timestamptz(6)
  confirmed_by_officer_id     String?          @db.Uuid
  confirmed_by_officer        Officer?         @relation("SelectionConfirmedBy", fields: [confirmed_by_officer_id], references: [id], onDelete: Restrict)
  objection_window_overridden Boolean          @default(false)
  override_reason             String?
  sanction_order              SanctionOrder?
  disbursements               Disbursement[]
  grievances                  Grievance[]""")

add_before_first_index('Disbursement', """  // Phase 9. NO bank-account reference of any kind is stored here: bank_account
  // is on the Phase 3 sensitive list, and even a masked/partial reference is
  // derived from it. Correlating a disbursement with an account means
  // decrypting the Applicant row through the PII extension - by design.
  currency                 String // ISO 4217 (DB CHECK); benefits[] are in mixed currencies
  selection_id             String        @db.Uuid
  selection                Selection     @relation(fields: [selection_id], references: [id], onDelete: Restrict)
  sanction_order_id        String        @db.Uuid
  sanction_order           SanctionOrder @relation(fields: [sanction_order_id], references: [id], onDelete: Restrict)
  academic_year            String
  scheduled_date           DateTime      @db.Date
  benefit_lines            Json // the benefits[] lines summed into this instalment
  initiated_by_officer_id  String?       @db.Uuid
  initiated_by_officer     Officer?      @relation("DisbursementInitiatedBy", fields: [initiated_by_officer_id], references: [id], onDelete: Restrict)
  reconciled_by_officer_id String?       @db.Uuid
  reconciled_by_officer    Officer?      @relation("DisbursementReconciledBy", fields: [reconciled_by_officer_id], references: [id], onDelete: Restrict)
  reconciled_at            DateTime?     @db.Timestamptz(6)
  grievances               Grievance[]""")

add_before_first_index('Renewal', """  // Phase 9: renewal cycle (NFST / NOS only). verification_status is the state:
  // PENDING -> ENDORSED -> APPROVED | DISCONTINUED (DB CHECK).
  scheme_version_id              String        @db.Uuid // the application's FROZEN version, evaluated on renewal
  scheme_version                 SchemeVersion @relation(fields: [scheme_version_id], references: [id], onDelete: Restrict)
  progress_report                String
  submitted_by_account_id        String?       @db.Uuid
  endorsed_by_officer_id         String?       @db.Uuid
  endorsed_by_officer            Officer?      @relation("RenewalEndorsedBy", fields: [endorsed_by_officer_id], references: [id], onDelete: Restrict)
  endorsed_at                    DateTime?     @db.Timestamptz(6)
  endorsement_remarks            String?
  continuation_rule_id           String?
  continuation_verdict           String? // PASS | FAIL | ERROR
  continuation_evaluation_run_id String?       @db.Uuid
  continuation_checked_at        DateTime?     @db.Timestamptz(6)
  decided_by_officer_id          String?       @db.Uuid
  decided_by_officer             Officer?      @relation("RenewalDecidedBy", fields: [decided_by_officer_id], references: [id], onDelete: Restrict)
  decision_remarks               String?
  updated_at                     DateTime      @default(now()) @updatedAt @db.Timestamptz(6)""")

s = s.rstrip() + """

// ---------------------------------------------------------
// 9. Post-selection (Phase 9): sanction orders and grievances
// ---------------------------------------------------------

model SanctionOrder {
  id                      String         @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  selection_id            String         @unique @db.Uuid
  selection               Selection      @relation(fields: [selection_id], references: [id], onDelete: Restrict)
  application_id          String         @db.Uuid
  application             Application    @relation(fields: [application_id], references: [id], onDelete: Restrict)
  content                 Json // canonical order data
  content_sha256          String // SHA-256 of the canonical JSON of content (not of the PDF bytes)
  pdf_storage_key         String
  generated_by_officer_id String         @db.Uuid
  generated_by_officer    Officer        @relation("SanctionOrderGeneratedBy", fields: [generated_by_officer_id], references: [id], onDelete: Restrict)
  generated_at            DateTime       @default(now()) @db.Timestamptz(6)
  disbursements           Disbursement[]

  @@index([application_id])
  @@map("sanction_orders")
}

model Grievance {
  id                     String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  application_id         String        @db.Uuid
  application            Application   @relation(fields: [application_id], references: [id], onDelete: Restrict)
  raised_by_applicant_id String        @db.Uuid
  raised_by_applicant    Applicant     @relation(fields: [raised_by_applicant_id], references: [id], onDelete: Restrict)
  subject_type           String // APPLICATION | SELECTION | DISBURSEMENT | SELECTION_OBJECTION (DB CHECK)
  selection_id           String?       @db.Uuid
  selection              Selection?    @relation(fields: [selection_id], references: [id], onDelete: Restrict)
  disbursement_id        String?       @db.Uuid
  disbursement           Disbursement? @relation(fields: [disbursement_id], references: [id], onDelete: Restrict)
  selection_run_id       String?       @db.Uuid // objection: the run the application was NOT selected in
  description            String
  status                 String        @default("OPEN") // OPEN | IN_PROGRESS | RESOLVED | REJECTED (DB CHECK)
  status_entered_at      DateTime      @default(now()) @db.Timestamptz(6)
  sla_due_at             DateTime?     @db.Timestamptz(6)
  resolution_note        String?
  resolved_by_officer_id String?       @db.Uuid
  resolved_by_officer    Officer?      @relation("GrievanceResolvedBy", fields: [resolved_by_officer_id], references: [id], onDelete: Restrict)
  resolved_at            DateTime?     @db.Timestamptz(6)
  created_at             DateTime      @default(now()) @db.Timestamptz(6)
  updated_at             DateTime      @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([application_id])
  @@index([status, sla_due_at], map: "grievances_status_sla_idx")
  @@index([selection_run_id])
  @@map("grievances")
}
"""

add_line_after('Application', r'\n  notifications\s+Notification\[\]\n', '  sanction_orders       SanctionOrder[]\n  grievances            Grievance[]\n')
add_line_after('Applicant', r'\n  applications\s+Application\[\]\n', '  grievances            Grievance[]\n')
add_line_after('SchemeVersion', r'\n  rule_evaluations\s+RuleEvaluation\[\]\n', '  renewals              Renewal[]\n')
add_line_after('Officer', r'\n  extractions_confirmed[^\n]*\n', """  selections_confirmed      Selection[]     @relation("SelectionConfirmedBy")
  sanction_orders_generated SanctionOrder[] @relation("SanctionOrderGeneratedBy")
  disbursements_initiated   Disbursement[]  @relation("DisbursementInitiatedBy")
  disbursements_reconciled  Disbursement[]  @relation("DisbursementReconciledBy")
  renewals_endorsed         Renewal[]       @relation("RenewalEndorsedBy")
  renewals_decided          Renewal[]       @relation("RenewalDecidedBy")
  grievances_resolved       Grievance[]     @relation("GrievanceResolvedBy")
""")
open(p, 'w', encoding='utf8', newline='\n').write(s + '\n')
print('schema updated')
