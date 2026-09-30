import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';

// ============================================================================
// Types for Predicate-based Config Schema
// ============================================================================
interface PredicateRule {
  id: string;
  type: 'eligibility' | 'benefit_note' | 'operational' | 'unmapped';
  expr: string;
  params: Record<string, any>;
  doc_refs: string[];
  message_key: string;
}

interface SchemeBenefit {
  id: string;
  condition?: string;
  description?: string;
  amount_monthly?: number | null;
  amount_annual?: number | null;
  currency?: string;
  duration_months?: number | null;
  disbursement_channel?: string;
  components?: Record<string, any>;
  [key: string]: any;
}

interface TransformedConfig {
  rules: PredicateRule[];
  benefits: SchemeBenefit[];
  required_documents: string[];
  fund_sharing_ratio: string | null;
  metadata: {
    source_document?: string;
    source_url?: string;
    extraction_confidence?: string;
    extraction_notes?: string;
    data_verified: boolean;
    [key: string]: any;
  };
}

interface SchemeVersionSeedV2 {
  scheme_code: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  config: TransformedConfig;
  source_document?: string;
  source_url?: string;
  extraction_confidence?: string;
  extraction_notes?: string;
}

// ============================================================================
// Transformation Logic per Scheme
// ============================================================================
function transformConfig(
  schemeCode: string,
  versionNo: number,
  oldConfig: Record<string, any>,
  meta: {
    source_document?: string;
    source_url?: string;
    extraction_confidence?: string;
    extraction_notes?: string;
  }
): TransformedConfig {
  const rules: PredicateRule[] = [];
  const benefits: SchemeBenefit[] = [];

  // 1. Eligibility Rule: Income Ceiling (or documented omission if null)
  if (oldConfig.income_limit_annual !== null && oldConfig.income_limit_annual !== undefined) {
    rules.push({
      id: 'income_ceiling',
      type: 'eligibility',
      expr: 'applicant.family_income_annual <= params.income_ceiling',
      params: {
        income_ceiling: Number(oldConfig.income_limit_annual),
        notes: oldConfig.income_limit_notes ?? undefined,
      },
      doc_refs: ['income_certificate'],
      message_key: 'err.income_ceiling_exceeded',
      verification: {
        status: 'PENDING_AUDIT',
        source_clause: 'Clause: Family Income Ceiling from all sources',
      },
    });
  } else {
    // Explicitly document schemes with no income criteria (e.g. NFST fellowship)
    rules.push({
      id: 'income_criteria_exemption',
      type: 'benefit_note',
      expr: 'true',
      params: {
        income_ceiling: null,
        notes: oldConfig.income_limit_notes ?? 'No annual family income limit applicable for this fellowship/scheme.',
      },
      doc_refs: [],
      message_key: 'info.no_income_ceiling',
      verification: {
        status: 'PENDING_AUDIT',
        source_clause: 'Clause: No parental income ceiling applicable',
      },
    });
  }

  // 2. Eligibility Rule: Category Match
  rules.push({
    id: 'category_match',
    type: 'eligibility',
    expr: 'applicant.category in params.allowed_categories',
    params: {
      allowed_categories: oldConfig.eligible_categories || ['ST'],
    },
    doc_refs: ['caste_certificate'],
    message_key: 'err.category_ineligible',
    verification: {
      status: 'PENDING_AUDIT',
      source_clause: 'Clause: Target Beneficiary Category (ST / PVTG)',
    },
  });

  // 3. Eligibility Rule: Education Level
  rules.push({
    id: 'education_level_match',
    type: 'eligibility',
    expr: 'applicant.education_level matches params.eligible_level',
    params: {
      eligible_level: oldConfig.eligible_education_level,
    },
    doc_refs: ['marksheet', 'bonafide_certificate'],
    message_key: 'err.education_level_ineligible',
    verification: {
      status: 'PENDING_AUDIT',
      source_clause: 'Clause: Eligible Education Stage & Institution Criteria',
    },
  });

  // 4. Scheme-specific Duration / Tenure Rules (fixes crude heuristic bug)
  if (oldConfig.duration) {
    if (schemeCode === 'PRE_MATRIC') {
      rules.push({
        id: 'pre_matric_class_tenure',
        type: 'eligibility',
        expr: "['IX', 'X'].includes(applicant.class_level) && applicant.academic_year_number <= 2",
        params: {
          eligible_classes: ['IX', 'X'],
          max_academic_years: 2,
          annual_entitlement_months: 10,
          source_text: oldConfig.duration,
        },
        doc_refs: ['bonafide_certificate'],
        message_key: 'err.pre_matric_class_or_tenure_exceeded',
        verification: {
          status: 'PENDING_AUDIT',
          source_clause: 'Clause: Classes IX and X (Maximum 2 academic years; 10 months/year)',
        },
      });
    } else if (schemeCode === 'POST_MATRIC') {
      rules.push({
        id: 'post_matric_course_tenure',
        type: 'operational',
        expr: 'applicant.academic_year_number <= applicant.enrolled_course_duration_years',
        params: {
          tenure_policy: 'Full sanctioned duration of course (payable for maximum 10 months per academic year)',
          annual_entitlement_months: 10,
          source_text: oldConfig.duration,
        },
        doc_refs: ['bonafide_certificate', 'institution_verification'],
        message_key: 'err.course_duration_exceeded',
        verification: {
          status: 'PENDING_AUDIT',
          source_clause: 'Clause: Duration of the course as approved by regulatory body',
        },
      });
    } else if (schemeCode === 'TOP_CLASS') {
      rules.push({
        id: 'top_class_course_tenure',
        type: 'operational',
        expr: 'applicant.academic_year_number <= applicant.notified_course_duration_years',
        params: {
          tenure_policy: 'Full tenure of the graduate/postgraduate degree as notified by the premier institution',
          source_text: oldConfig.duration,
        },
        doc_refs: ['bonafide_certificate', 'admission_offer_letter'],
        message_key: 'err.top_class_tenure_exceeded',
        verification: {
          status: 'PENDING_AUDIT',
          source_clause: 'Clause: Full tenure of degree program in notified institution',
        },
      });
    } else if (schemeCode === 'NFST') {
      rules.push({
        id: 'fellowship_tenure_limit',
        type: 'eligibility',
        expr: "applicant.degree_enrolled == 'M.Phil' ? applicant.tenure_years <= params.mphil_max_years : applicant.tenure_years <= params.phd_max_years",
        params: {
          mphil_max_years: 2,
          phd_max_years: 5,
          integrated_mphil_phd_max_years: 5,
          discontinuation_clause: 'Terminates upon dissertation submission or completion of prescribed tenure, whichever is earlier',
          source_text: oldConfig.duration,
        },
        doc_refs: ['research_progress_report', 'bonafide_certificate'],
        message_key: 'err.fellowship_tenure_exceeded',
        verification: {
          status: 'PENDING_AUDIT',
          source_clause: 'Clause: M.Phil (2 yrs) / Ph.D (5 yrs) maximum fellowship duration',
        },
      });
    } else if (schemeCode === 'NOS') {
      rules.push({
        id: 'overseas_tenure_limit',
        type: 'eligibility',
        expr: "applicant.degree_enrolled == 'Master' ? applicant.tenure_years <= params.masters_max_years : applicant.tenure_years <= params.phd_max_years",
        params: {
          masters_max_years: 2,
          phd_max_years: 4,
          postdoc_max_years: 2,
          source_text: oldConfig.duration,
        },
        doc_refs: ['admission_offer_letter', 'i20_or_cas_statement'],
        message_key: 'err.overseas_tenure_exceeded',
        verification: {
          status: 'PENDING_AUDIT',
          source_clause: 'Clause: Master Degree (1-2 yrs) / Ph.D (4 yrs) overseas duration',
        },
      });
    }
  }

  // 5. Decompose benefit_structure based on scheme
  const bs = oldConfig.benefit_structure || {};

  if (schemeCode === 'PRE_MATRIC') {
    if (bs.day_scholars) {
      benefits.push({
        id: 'day_scholar_entitlement',
        condition: 'applicant.is_hosteller == false',
        description: 'Monthly maintenance allowance and annual books/adhoc grant for day scholars',
        amount_monthly: bs.day_scholars.monthly_maintenance_allowance_inr ?? null,
        amount_annual: bs.day_scholars.total_annual_entitlement_inr ?? null,
        currency: 'INR',
        duration_months: 10,
        disbursement_channel: 'STUDENT_DBT',
        components: bs.day_scholars,
      });
    }

    if (bs.hostellers) {
      benefits.push({
        id: 'hosteller_entitlement',
        condition: 'applicant.is_hosteller == true',
        description: 'Monthly maintenance allowance and annual books/adhoc grant for hostellers',
        amount_monthly: bs.hostellers.monthly_maintenance_allowance_inr ?? null,
        amount_annual: bs.hostellers.total_annual_entitlement_inr ?? null,
        currency: 'INR',
        duration_months: 10,
        disbursement_channel: 'STUDENT_DBT',
        components: bs.hostellers,
      });
    }

    const disability = bs.additional_disability_allowance || bs.additional_disability_allowances_private_unaided_schools;
    if (disability) {
      benefits.push({
        id: 'disability_allowance',
        condition: 'applicant.is_disabled == true',
        description: 'Special allowances for divyangjan (reader, escort, transport, coaching allowances)',
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
        components: disability,
      });
    }
  } else if (schemeCode === 'POST_MATRIC') {
    if (bs.group_I || bs.group_II || bs.group_III || bs.group_IV) {
      ['group_I', 'group_II', 'group_III', 'group_IV'].forEach((grp) => {
        if (bs[grp]) {
          benefits.push({
            id: `post_matric_${grp}_entitlement`,
            condition: `applicant.course_group == '${grp.toUpperCase()}'`,
            description: `Annual maintenance and fee allowance for ${grp}`,
            currency: 'INR',
            disbursement_channel: 'STUDENT_DBT',
            components: bs[grp],
          });
        }
      });
      if (bs.additional_provisions) {
        rules.push({
          id: 'post_matric_additional_provisions',
          type: 'benefit_note',
          expr: 'true',
          params: bs.additional_provisions,
          doc_refs: [],
          message_key: 'info.additional_provisions',
        });
      }
    } else {
      if (bs.fee_component) {
        benefits.push({
          id: 'tuition_fee_reimbursement',
          condition: 'true',
          description: 'Compulsory non-refundable fees payment',
          disbursement_channel: 'INSTITUTE_PFMS',
          components: bs.fee_component,
        });
      }
      if (bs.stipend_maintenance) {
        benefits.push({
          id: 'maintenance_stipend_component',
          condition: 'true',
          description: 'Monthly maintenance stipend for course duration',
          currency: 'INR',
          disbursement_channel: 'STUDENT_DBT',
          components: bs.stipend_maintenance,
        });
      }
      if (bs.additional_disability_allowance) {
        benefits.push({
          id: 'disability_allowance_post_matric',
          condition: 'applicant.is_disabled == true',
          description: 'Additional disability support allowances',
          currency: 'INR',
          components: bs.additional_disability_allowance,
        });
      }
    }
  } else if (schemeCode === 'TOP_CLASS') {
    if (bs.tuition_fees) {
      benefits.push({
        id: 'top_class_tuition_fees',
        condition: 'true',
        description: 'Full tuition fees and non-refundable charges in notified premier institute',
        disbursement_channel: 'INSTITUTE_PFMS',
        components: bs.tuition_fees,
      });
    }
    if (bs.living_expenses_stipend_annual_inr || bs.living_expenses_stipend_monthly_inr) {
      benefits.push({
        id: 'living_expenses_stipend',
        condition: 'true',
        description: 'Monthly living expenses stipend',
        amount_monthly: bs.living_expenses_stipend_monthly_inr ?? 3000,
        amount_annual: bs.living_expenses_stipend_annual_inr ?? 36000,
        currency: 'INR',
        duration_months: 12,
        disbursement_channel: 'STUDENT_DBT',
      });
    }
    if (bs.books_and_stationery_annual_inr) {
      benefits.push({
        id: 'books_and_stationery_grant',
        condition: 'true',
        description: 'Annual books and stationery grant',
        amount_annual: bs.books_and_stationery_annual_inr,
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
      });
    }
    if (bs.computer_and_accessories_one_time_inr) {
      benefits.push({
        id: 'computer_hardware_grant',
        condition: 'applicant.course_year == 1',
        description: 'One-time grant for computer, printer, and digital accessories',
        amount_annual: bs.computer_and_accessories_one_time_inr,
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
      });
    }
    if (bs.disbursement_breakdown) {
      rules.push({
        id: 'disbursement_breakdown_guideline',
        type: 'benefit_note',
        expr: 'true',
        params: bs.disbursement_breakdown,
        doc_refs: [],
        message_key: 'info.disbursement_schedule',
      });
    }
  } else if (schemeCode === 'NFST') {
    if (bs.fellowship_stipend) {
      benefits.push({
        id: 'jrf_monthly_stipend',
        condition: "applicant.fellowship_tier == 'JRF'",
        description: 'Junior Research Fellow (JRF) monthly stipend',
        amount_monthly: bs.fellowship_stipend.jrf_monthly_stipend_inr ?? null,
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
      });
      benefits.push({
        id: 'srf_monthly_stipend',
        condition: "applicant.fellowship_tier == 'SRF'",
        description: 'Senior Research Fellow (SRF) monthly stipend',
        amount_monthly: bs.fellowship_stipend.srf_monthly_stipend_inr ?? null,
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
      });
    }
    if (bs.contingency_annual) {
      benefits.push({
        id: 'research_contingency_grant',
        condition: 'true',
        description: 'Annual research contingency grant by discipline',
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
        components: bs.contingency_annual,
      });
    }
    if (bs.hra) {
      benefits.push({
        id: 'house_rent_allowance_hra',
        condition: 'applicant.hosteller == false',
        description: 'House Rent Allowance as per city classification (X/Y/Z)',
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
        components: typeof bs.hra === 'string' ? { rate_guidelines: bs.hra } : bs.hra,
      });
    }
    if (bs.escorts_reader_allowance_divyangjan_monthly_inr) {
      benefits.push({
        id: 'divyangjan_escorts_reader_allowance',
        condition: 'applicant.is_disabled == true',
        description: 'Reader and escort allowance for physically handicapped research scholars',
        amount_monthly: bs.escorts_reader_allowance_divyangjan_monthly_inr,
        currency: 'INR',
        disbursement_channel: 'STUDENT_DBT',
      });
    }
    if (bs.slots_allocation_annual_750) {
      rules.push({
        id: 'nfst_slots_quota',
        type: 'operational',
        expr: 'true',
        params: typeof bs.slots_allocation_annual_750 === 'object' ? bs.slots_allocation_annual_750 : { slots: bs.slots_allocation_annual_750 },
        doc_refs: [],
        message_key: 'info.slots_quota',
      });
    }
    if (bs.selection_criteria_revision) {
      rules.push({
        id: 'nfst_selection_criteria',
        type: 'eligibility',
        expr: 'applicant.has_cleared_ugc_net_jrf == true',
        params: typeof bs.selection_criteria_revision === 'string' ? { criteria_description: bs.selection_criteria_revision } : bs.selection_criteria_revision,
        doc_refs: ['ugc_net_scorecard'],
        message_key: 'err.net_jrf_required',
      });
    }
  } else if (schemeCode === 'NOS') {
    if (bs.annual_maintenance_allowance) {
      benefits.push({
        id: 'nos_maintenance_allowance_usd',
        condition: "applicant.destination_country != 'UK'",
        description: 'Annual maintenance allowance for foreign universities outside the United Kingdom',
        amount_annual: bs.annual_maintenance_allowance.united_states_and_other_countries_usd ?? 15400,
        currency: 'USD',
        disbursement_channel: 'STUDENT_DBT',
      });
      benefits.push({
        id: 'nos_maintenance_allowance_gbp',
        condition: "applicant.destination_country == 'UK'",
        description: 'Annual maintenance allowance for foreign universities in the United Kingdom',
        amount_annual: bs.annual_maintenance_allowance.united_kingdom_gbp ?? 9900,
        currency: 'GBP',
        disbursement_channel: 'STUDENT_DBT',
      });
    }
    if (bs.annual_contingency_and_equipment_allowance) {
      benefits.push({
        id: 'nos_contingency_allowance',
        condition: 'true',
        description: 'Annual contingency and equipment grant for overseas scholars',
        components: bs.annual_contingency_and_equipment_allowance,
      });
    }
    if (bs.tuition_fees) {
      benefits.push({
        id: 'nos_tuition_fees_direct_payment',
        condition: 'true',
        description: 'Actual overseas university tuition fees paid directly to institute or student',
        disbursement_channel: 'MEA_MISSION',
        components: typeof bs.tuition_fees === 'string' ? { tuition_fee_guidelines: bs.tuition_fees } : bs.tuition_fees,
      });
    }
    benefits.push({
      id: 'nos_travel_and_medical_insurance',
      condition: 'true',
      description: 'Economy class round-trip air passage, visa fees, and compulsory health insurance',
      components: {
        air_passage: bs.air_passage,
        visa_fees: bs.visa_fees,
        medical_insurance: bs.medical_insurance_premium,
        incidental_journey_max_usd: bs.incidental_journey_expenses_max_usd,
      },
    });

    if (bs.age_limits) {
      rules.push({
        id: 'nos_age_limit',
        type: 'eligibility',
        expr: 'applicant.age <= params.maximum_age',
        params: typeof bs.age_limits === 'object' ? bs.age_limits : { maximum_age: bs.age_limits },
        doc_refs: ['dob_certificate'],
        message_key: 'err.age_limit_exceeded',
      });
    }
    if (bs.slots_distribution_total_20) {
      rules.push({
        id: 'nos_slots_allocation',
        type: 'operational',
        expr: 'true',
        params: typeof bs.slots_distribution_total_20 === 'object' ? bs.slots_distribution_total_20 : { slots_total: bs.slots_distribution_total_20 },
        doc_refs: [],
        message_key: 'info.slots_distribution',
      });
    }
    if (bs.selection_priority_revision) {
      rules.push({
        id: 'nos_selection_priority_rules',
        type: 'eligibility',
        expr: 'applicant.university_qs_ranking <= 1000',
        params: typeof bs.selection_priority_revision === 'string' ? { priority_guidelines: bs.selection_priority_revision } : bs.selection_priority_revision,
        doc_refs: ['admission_offer_letter'],
        message_key: 'err.university_rank_ineligible',
      });
    }
  }

  // Safety check: ensure any unmapped fields in benefit_structure are captured as "unmapped" or "benefit_note"
  const handledKeys = new Set([
    'day_scholars',
    'hostellers',
    'additional_disability_allowances_private_unaided_schools',
    'additional_disability_allowance',
    'group_I',
    'group_II',
    'group_III',
    'group_IV',
    'additional_provisions',
    'fee_component',
    'stipend_maintenance',
    'tuition_fees',
    'living_expenses_stipend_monthly_inr',
    'living_expenses_stipend_annual_inr',
    'books_and_stationery_annual_inr',
    'computer_and_accessories_one_time_inr',
    'disbursement_breakdown',
    'fellowship_stipend',
    'contingency_annual',
    'hra',
    'escorts_reader_allowance_divyangjan_monthly_inr',
    'slots_allocation_annual_750',
    'selection_criteria_revision',
    'annual_maintenance_allowance',
    'annual_contingency_and_equipment_allowance',
    'visa_fees',
    'medical_insurance_premium',
    'air_passage',
    'incidental_journey_expenses_max_usd',
    'poll_tax',
    'local_travel',
    'slots_distribution_total_20',
    'age_limits',
    'selection_priority_revision',
  ]);

  for (const [key, value] of Object.entries(bs)) {
    if (!handledKeys.has(key)) {
      rules.push({
        id: `unmapped_${key}`,
        type: 'unmapped',
        expr: 'true',
        params: { key, value },
        doc_refs: [],
        message_key: `info.unmapped.${key}`,
      });
    }
  }

  return {
    rules,
    benefits,
    required_documents: oldConfig.required_documents || [],
    fund_sharing_ratio: oldConfig.fund_sharing_ratio ?? null,
    metadata: {
      source_document: meta.source_document,
      source_url: meta.source_url,
      extraction_confidence: meta.extraction_confidence,
      extraction_notes: meta.extraction_notes,
      data_verified: false, // Task 7: explicitly false until human audit
    },
  };
}

// ============================================================================
// Main Execution
// ============================================================================
async function run() {
  console.log('🔄 Transforming scheme versions from flat to predicate/rules format...');

  const schemaPath = path.resolve(__dirname, '../schemas/scheme-config.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  const inputSeedPath = path.resolve(__dirname, '../scheme_versions_seed.json');
  const rawInput = fs.readFileSync(inputSeedPath, 'utf-8');
  const originalSeeds = JSON.parse(rawInput);

  console.log(`Loaded ${originalSeeds.length} original scheme version records.`);

  const v2Seeds: SchemeVersionSeedV2[] = [];
  let unmappedCount = 0;

  for (const entry of originalSeeds) {
    const transformedConfig = transformConfig(
      entry.scheme_code,
      entry.version_no,
      entry.config,
      {
        source_document: entry.source_document,
        source_url: entry.source_url,
        extraction_confidence: entry.extraction_confidence,
        extraction_notes: entry.extraction_notes,
      }
    );

    // Validate transformed config against canonical JSON Schema
    const isValid = validate(transformedConfig);
    if (!isValid) {
      console.error(`❌ Validation failed for ${entry.scheme_code} v${entry.version_no}:`, validate.errors);
      throw new Error(`Schema validation failed on transformed config for ${entry.scheme_code} v${entry.version_no}`);
    }

    // Check for unmapped rules
    const unmapped = transformedConfig.rules.filter((r) => r.type === 'unmapped');
    if (unmapped.length > 0) {
      console.warn(`⚠️  Found ${unmapped.length} unmapped field(s) in ${entry.scheme_code} v${entry.version_no}`);
      unmappedCount += unmapped.length;
    }

    v2Seeds.push({
      scheme_code: entry.scheme_code,
      version_no: entry.version_no,
      effective_from: entry.effective_from,
      effective_to: entry.effective_to,
      config: transformedConfig,
      source_document: entry.source_document,
      source_url: entry.source_url,
      extraction_confidence: entry.extraction_confidence,
      extraction_notes: entry.extraction_notes,
    });
  }

  const outputPath = path.resolve(__dirname, '../scheme_versions_seed_v2.json');
  fs.writeFileSync(outputPath, JSON.stringify(v2Seeds, null, 2), 'utf-8');

  console.log(`\n✅ Migration Complete!`);
  console.log(`   Output written to: ${outputPath}`);
  console.log(`   Total versions preserved: ${v2Seeds.length}`);
  console.log(`   Total unmapped entries captured: ${unmappedCount}`);
}

run().catch((err) => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
