import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DbContext } from '../database/db-context';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { EmailChannel } from './channels/email.channel';
import { SmsGateway } from './channels/sms.gateway';
import { NotificationDispatcher } from './notification-dispatcher';
import type { Audience, Channel, NotificationIntent } from './notification-intents';
import { officerCovers } from './recipients';
import {
  NOTICE_CODE,
  codesNeeded,
  renderDeficiencyNotice,
} from '../deficiencies/deficiency-notice';
import { DEFAULT_LOCALE, redactedParams, render, Rendered } from './templates';

interface Recipient {
  account_id: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  /** Phase 13C: the applicant's preferred language; Phase 16: the officer's (default DEFAULT_LOCALE). */
  locale: string;
}

/**
 * Delivers an intent to every resolved recipient on each of its channels,
 * one notifications row per (recipient, channel):
 *   IN_APP - the row itself (SENT on insert), read via GET /api/v1/notifications;
 *   EMAIL  - SMTP (Mailpit), PENDING -> SENT | FAILED;
 *   SMS    - SmsGateway (mock), PENDING -> SENT | FAILED; only with a phone on record.
 * The row stores the text rendered FOR STORAGE (sensitive-named parameters
 * redacted); the live channels get the text rendered with real values.
 *
 * Runs in the listener's clean context (no actor, no transaction): it reads
 * unprotected tables (officers, accounts) and writes notifications. Phase 17
 * (M45): applicants has row-level security, so the applicant recipient is
 * looked up as the SYSTEM actor (read only). At-most-once and in-process: see the Phase 8 limitations.
 */
@Injectable()
export class NotificationDeliveryService extends NotificationDispatcher {
  constructor(
    private readonly db: DbContext,
    private readonly system: SystemTransactionRunner,
    private readonly email: EmailChannel,
    private readonly sms: SmsGateway,
    @InjectPinoLogger(NotificationDeliveryService.name) private readonly logger: PinoLogger,
  ) {
    super();
  }

  async dispatch(intent: NotificationIntent): Promise<void> {
    const recipients = await this.resolve(intent.audience);
    const redacted = redactedParams(intent.template_key);
    const audience = intent.audience.kind === 'OFFICERS' ? intent.audience : null;

    for (const r of recipients) {
      // Phase 13C: rendered in the recipient's language where a template
      // exists in it; otherwise English, with the language asked for kept
      // in requested_locale (locale <> requested_locale = a fallback).
      const { live, stored } = await this.renderFor(intent, r.locale);
      if (stored.locale !== r.locale) {
        this.logger.info(
          { template: intent.template_key, requested_locale: r.locale, locale: stored.locale },
          'notification language fallback',
        );
      }
      for (const channel of intent.channels) {
        const address = channel === 'EMAIL' ? r.email : channel === 'SMS' ? r.phone : null;
        if (channel !== 'IN_APP' && !address) continue;
        const now = new Date();
        const row = await this.db.client.notification.create({
          data: {
            event_type: intent.source_event,
            template_key: intent.template_key,
            locale: stored.locale,
            requested_locale: r.locale,
            channel,
            recipient_account_id: r.account_id,
            recipient_address: address,
            recipient_role: r.role,
            recipient_jurisdiction_state: audience?.jurisdiction_state ?? null,
            recipient_jurisdiction_district: audience?.jurisdiction_district ?? null,
            application_id: intent.application_id,
            subject: stored.subject,
            body: stored.body,
            redacted_params: redacted,
            status: channel === 'IN_APP' ? 'SENT' : 'PENDING',
            delivered_at: channel === 'IN_APP' ? now : null,
          },
          select: { id: true },
        });
        if (channel !== 'IN_APP') {
          await this.deliver(row.id, channel, address!, live.subject, live.body);
        }
      }
    }
  }

  /** Live and stored renderings of the intent in `locale` (or its English fallback). */
  private async renderFor(
    intent: NotificationIntent,
    locale: string,
  ): Promise<{ live: Rendered; stored: Rendered }> {
    if (intent.template_key === NOTICE_CODE && intent.deficiency_items) {
      // Phase 13D: an item with a crop links to it (a portal path; never embedded).
      const items = intent.deficiency_items.map((i) => ({
        ...i,
        crop_url:
          i.has_crop && i.item_id && intent.application_id
            ? `/api/v1/applications/${intent.application_id}/deficiencies/items/${i.item_id}/crop`
            : null,
      }));
      const rows = await this.db.client.noticeTemplate.findMany({
        where: {
          code: { in: codesNeeded(items) },
          locale: { in: [...new Set([locale, DEFAULT_LOCALE])] },
          channel: 'PORTAL',
          is_active: true,
        },
        select: { code: true, locale: true, subject_template: true, body_template: true },
      });
      const n = renderDeficiencyNotice(rows, locale, intent.application_no ?? '-', items);
      // No sensitive parameters in this notice: the stored copy is the same text.
      const rendered: Rendered = { locale: n.locale, subject: n.subject, body: n.body };
      return { live: rendered, stored: rendered };
    }
    return {
      live: render(intent.template_key, intent.params, { forStorage: false, locale }),
      stored: render(intent.template_key, intent.params, { forStorage: true, locale }),
    };
  }

  private async deliver(id: string, channel: Channel, to: string, subject: string, body: string) {
    try {
      if (channel === 'EMAIL') await this.email.send(to, subject, body);
      else await this.sms.send(to, `${subject}\n${body}`);
      await this.db.client.notification.update({
        where: { id },
        data: { status: 'SENT', delivered_at: new Date() },
      });
    } catch (err) {
      this.logger.warn({ err, notificationId: id, channel }, 'notification delivery failed');
      await this.db.client.notification.update({
        where: { id },
        data: {
          status: 'FAILED',
          error: err instanceof Error ? err.message.slice(0, 500) : 'failed',
        },
      });
    }
  }

  private async resolve(audience: Audience): Promise<Recipient[]> {
    const client = this.db.client;
    if (audience.kind === 'APPLICANT') {
      const a = await this.system.run(`notification:${audience.applicant_id}`, () =>
        this.db.client.applicant.findUnique({
          where: { id: audience.applicant_id },
          select: { user_id: true, email: true, phone: true, preferred_language: true },
        }),
      );
      return a?.user_id
        ? [
            {
              account_id: a.user_id,
              email: a.email,
              phone: a.phone,
              role: null,
              locale: a.preferred_language,
            },
          ]
        : [];
    }
    const rows = await client.officer.findMany({
      where: {
        is_active: true,
        account: { is_active: true },
        role: { name: { in: audience.roles } },
      },
      select: {
        id: true,
        user_id: true,
        email: true,
        phone: true,
        jurisdiction_state: true,
        jurisdiction_district: true,
        role: { select: { name: true } },
      },
      orderBy: { email: 'asc' },
    });
    const covered = rows.filter((o) => officerCovers(o, audience));
    // Phase 16 (M50): the officer's chosen language (officer_preferences),
    // else the default; a missing template in it falls back to English with
    // requested_locale recorded, as for applicants.
    const prefs = await client.officerPreference.findMany({
      where: { officer_id: { in: covered.map((o) => o.id) } },
      select: { officer_id: true, preferred_language: true },
    });
    const lang = new Map(prefs.map((p) => [p.officer_id, p.preferred_language]));
    return covered.map((o) => ({
      account_id: o.user_id,
      email: o.email,
      phone: o.phone,
      role: o.role.name,
      locale: lang.get(o.id) ?? DEFAULT_LOCALE,
    }));
  }
}
