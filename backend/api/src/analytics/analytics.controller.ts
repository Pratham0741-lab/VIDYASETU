import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { AnalyticsQueryDto, JurisdictionQueryDto } from './analytics.dto';
import { AnalyticsService } from './analytics.service';
import {
  disbursementsTable,
  fraudTable,
  funnelTable,
  jurisdictionTable,
  schemesTable,
  slaTable,
  verificationQualityTable,
  workloadTable,
} from './export-tables';
import { ExportFormat, ExportTable, exportView } from './exports';
import { RateLimit } from '../common/throttle/rate-limit';

const ANALYTICS_ROLES = [...REVIEWER_ROLES, AppRole.SUPER_ADMIN, AppRole.AUDITOR];
/**
 * Phase 16: officer workload is shown to state and national oversight only,
 * not to the district and institute officers whose own groups it describes.
 */
const WORKLOAD_ROLES = [
  AppRole.STATE_NODAL_OFFICER,
  AppRole.MINISTRY_OFFICER,
  AppRole.AUDITOR,
  AppRole.SUPER_ADMIN,
];

type WithMeta = { meta: Record<string, unknown> };
const VQ_TITLE = 'Verification quality (routing outcomes, not accuracy)';

/**
 * Phase 12 analytics: read-only aggregates, scoped by database row-level
 * security to the caller's jurisdiction, fixtures excluded unless a
 * SUPER_ADMIN asks for them. Every export (CSV; XLSX and PDF since Phase 16)
 * is built from the same result as its JSON view (never more columns or
 * rows), generated on demand and never stored.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  private async out<R extends WithMeta>(
    format: ExportFormat,
    actor: Actor,
    name: string,
    title: string,
    result: Promise<R>,
    table: (r: R) => ExportTable,
  ) {
    const r = await result;
    return exportView(format, name, title, r.meta, table(r), actor.role);
  }

  // ------------------------------------------------------------- funnel
  @Get('funnel')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({ summary: 'Funnel: submitted, verified, selected, sanctioned, disbursed.' })
  funnel(@CurrentActor() actor: Actor, @Query() q: AnalyticsQueryDto) {
    return this.analytics.funnel(actor, q);
  }

  @Get('funnel/export.csv')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Funnel as CSV (same scope and rules as the JSON view).' })
  funnelCsv(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('csv', a, 'funnel', 'Funnel', this.analytics.funnel(a, q), funnelTable);
  }

  @Get('funnel/export.xlsx')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Funnel as XLSX (data and metadata sheets).' })
  funnelXlsx(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('xlsx', a, 'funnel', 'Funnel', this.analytics.funnel(a, q), funnelTable);
  }

  @Get('funnel/export.pdf')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Funnel as PDF (footer: window, scope, fixtures, threshold).' })
  funnelPdf(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('pdf', a, 'funnel', 'Funnel', this.analytics.funnel(a, q), funnelTable);
  }

  // ---------------------------------------------------------------- sla
  @Get('sla')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({ summary: 'Time per stage (median, p90), SLA breaches, longest waits.' })
  sla(@CurrentActor() actor: Actor, @Query() q: AnalyticsQueryDto) {
    return this.analytics.sla(actor, q);
  }

  @Get('sla/export.csv')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'SLA view as CSV.' })
  slaCsv(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('csv', a, 'sla', 'SLA and bottlenecks', this.analytics.sla(a, q), slaTable);
  }

  @Get('sla/export.xlsx')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'SLA view as XLSX.' })
  slaXlsx(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('xlsx', a, 'sla', 'SLA and bottlenecks', this.analytics.sla(a, q), slaTable);
  }

  @Get('sla/export.pdf')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'SLA view as PDF.' })
  slaPdf(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('pdf', a, 'sla', 'SLA and bottlenecks', this.analytics.sla(a, q), slaTable);
  }

  // ------------------------------------------------------------ schemes
  @Get('schemes')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({ summary: 'Scheme performance by scheme and academic year; defect reasons.' })
  schemes(@CurrentActor() actor: Actor, @Query() q: AnalyticsQueryDto) {
    return this.analytics.schemes(actor, q);
  }

  @Get('schemes/export.csv')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Scheme performance as CSV (one row per scheme and year).' })
  schemesCsv(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.schemes(a, q);
    return this.out('csv', a, 'schemes', 'Scheme performance', r, schemesTable);
  }

  @Get('schemes/export.xlsx')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Scheme performance as XLSX.' })
  schemesXlsx(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.schemes(a, q);
    return this.out('xlsx', a, 'schemes', 'Scheme performance', r, schemesTable);
  }

  @Get('schemes/export.pdf')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Scheme performance as PDF.' })
  schemesPdf(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.schemes(a, q);
    return this.out('pdf', a, 'schemes', 'Scheme performance', r, schemesTable);
  }

  // ------------------------------------------------------ disbursements
  @Get('disbursements')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({
    summary: 'Disbursements by status and amount; State-DBT schemes shown as handled by the State.',
  })
  disbursements(@CurrentActor() actor: Actor, @Query() q: AnalyticsQueryDto) {
    return this.analytics.disbursements(actor, q);
  }

  @Get('disbursements/export.csv')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Disbursement view as CSV.' })
  disbursementsCsv(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.disbursements(a, q);
    return this.out('csv', a, 'disbursements', 'Disbursements', r, disbursementsTable);
  }

  @Get('disbursements/export.xlsx')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Disbursement view as XLSX.' })
  disbursementsXlsx(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.disbursements(a, q);
    return this.out('xlsx', a, 'disbursements', 'Disbursements', r, disbursementsTable);
  }

  @Get('disbursements/export.pdf')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Disbursement view as PDF.' })
  disbursementsPdf(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.disbursements(a, q);
    return this.out('pdf', a, 'disbursements', 'Disbursements', r, disbursementsTable);
  }

  // -------------------------------------------------------------- fraud
  @Get('fraud')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({ summary: 'Fraud flags by type, severity and disposition; held applications.' })
  fraud(@CurrentActor() actor: Actor, @Query() q: AnalyticsQueryDto) {
    return this.analytics.fraud(actor, q);
  }

  @Get('fraud/export.csv')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Fraud summary as CSV.' })
  fraudCsv(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('csv', a, 'fraud', 'Fraud summary', this.analytics.fraud(a, q), fraudTable);
  }

  @Get('fraud/export.xlsx')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Fraud summary as XLSX.' })
  fraudXlsx(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('xlsx', a, 'fraud', 'Fraud summary', this.analytics.fraud(a, q), fraudTable);
  }

  @Get('fraud/export.pdf')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Fraud summary as PDF.' })
  fraudPdf(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    return this.out('pdf', a, 'fraud', 'Fraud summary', this.analytics.fraud(a, q), fraudTable);
  }

  // -------------------------------------------------------- jurisdiction
  @Get('jurisdiction')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({
    summary: 'Rolled up by district (or institution) and state; small counts suppressed.',
  })
  jurisdiction(@CurrentActor() actor: Actor, @Query() q: JurisdictionQueryDto) {
    return this.analytics.jurisdiction(actor, q);
  }

  @Get('jurisdiction/export.csv')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Jurisdiction view as CSV (same page, same suppression).' })
  jurisdictionCsv(@CurrentActor() a: Actor, @Query() q: JurisdictionQueryDto) {
    const r = this.analytics.jurisdiction(a, q);
    return this.out('csv', a, 'jurisdiction', 'Jurisdiction rollup', r, jurisdictionTable);
  }

  @Get('jurisdiction/export.xlsx')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Jurisdiction view as XLSX (same page, same suppression).' })
  jurisdictionXlsx(@CurrentActor() a: Actor, @Query() q: JurisdictionQueryDto) {
    const r = this.analytics.jurisdiction(a, q);
    return this.out('xlsx', a, 'jurisdiction', 'Jurisdiction rollup', r, jurisdictionTable);
  }

  @Get('jurisdiction/export.pdf')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Jurisdiction view as PDF (same page, same suppression).' })
  jurisdictionPdf(@CurrentActor() a: Actor, @Query() q: JurisdictionQueryDto) {
    const r = this.analytics.jurisdiction(a, q);
    return this.out('pdf', a, 'jurisdiction', 'Jurisdiction rollup', r, jurisdictionTable);
  }

  // ------------------------------------------------ Phase 16: workload
  @Get('workload')
  @Roles(...WORKLOAD_ROLES)
  @ApiOperation({
    summary:
      'Officer workload by role and jurisdiction level (no officer ids): actions, overrides, handling time, queues, SLA breaches.',
  })
  workload(@CurrentActor() actor: Actor, @Query() q: AnalyticsQueryDto) {
    return this.analytics.workload(actor, q);
  }

  @Get('workload/export.csv')
  @Roles(...WORKLOAD_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Officer workload as CSV.' })
  workloadCsv(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.workload(a, q);
    return this.out('csv', a, 'workload', 'Officer workload', r, workloadTable);
  }

  @Get('workload/export.xlsx')
  @Roles(...WORKLOAD_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Officer workload as XLSX.' })
  workloadXlsx(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.workload(a, q);
    return this.out('xlsx', a, 'workload', 'Officer workload', r, workloadTable);
  }

  @Get('workload/export.pdf')
  @Roles(...WORKLOAD_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Officer workload as PDF.' })
  workloadPdf(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.workload(a, q);
    return this.out('pdf', a, 'workload', 'Officer workload', r, workloadTable);
  }

  // ------------------------------------- Phase 16: verification quality
  @Get('verification-quality')
  @Roles(...ANALYTICS_ROLES)
  @ApiOperation({
    summary:
      'Per document type and scheme: auto-verified, sent to review, corrected, overridden. Routing outcomes, not accuracy.',
  })
  verificationQuality(@CurrentActor() actor: Actor, @Query() q: AnalyticsQueryDto) {
    return this.analytics.verificationQuality(actor, q);
  }

  @Get('verification-quality/export.csv')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Verification quality as CSV.' })
  verificationQualityCsv(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.verificationQuality(a, q);
    return this.out('csv', a, 'verification-quality', VQ_TITLE, r, verificationQualityTable);
  }

  @Get('verification-quality/export.xlsx')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Verification quality as XLSX.' })
  verificationQualityXlsx(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.verificationQuality(a, q);
    return this.out('xlsx', a, 'verification-quality', VQ_TITLE, r, verificationQualityTable);
  }

  @Get('verification-quality/export.pdf')
  @Roles(...ANALYTICS_ROLES)
  @RateLimit('EXPORT')
  @ApiOperation({ summary: 'Verification quality as PDF.' })
  verificationQualityPdf(@CurrentActor() a: Actor, @Query() q: AnalyticsQueryDto) {
    const r = this.analytics.verificationQuality(a, q);
    return this.out('pdf', a, 'verification-quality', VQ_TITLE, r, verificationQualityTable);
  }
}
