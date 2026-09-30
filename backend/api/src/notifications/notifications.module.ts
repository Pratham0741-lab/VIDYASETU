import { Module } from '@nestjs/common';
import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { EmailChannel } from './channels/email.channel';
import { MockSmsGateway, SmsGateway } from './channels/sms.gateway';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDispatcher } from './notification-dispatcher';
import { NotificationListener } from './notification.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  OfficerPreferencesController,
  OfficerPreferencesService,
} from '../officers/officer-preferences';

/**
 * Notifications: domain-event listener -> intents -> delivery (in-app row,
 * email via SMTP/Mailpit, SMS via the mock gateway). The only place the SMS
 * implementation is chosen. Phase 16 (M50): officers' notice languages.
 */
@Module({
  controllers: [NotificationsController, OfficerPreferencesController],
  providers: [
    NotificationListener,
    NotificationsService,
    OfficerPreferencesService,
    EmailChannel,
    SystemTransactionRunner,
    { provide: SmsGateway, useClass: MockSmsGateway },
    { provide: NotificationDispatcher, useClass: NotificationDeliveryService },
  ],
})
export class NotificationsModule {}
