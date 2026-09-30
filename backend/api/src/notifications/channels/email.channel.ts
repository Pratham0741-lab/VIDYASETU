import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Email over SMTP (Mailpit in docker compose: SMTP_HOST / SMTP_PORT /
 * MAIL_FROM, validated at startup since Phase 0). Plain text only.
 */
@Injectable()
export class EmailChannel implements OnModuleDestroy {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: AppConfigService) {
    this.transport = createTransport({
      host: config.mail.smtpHost,
      port: config.mail.smtpPort,
      secure: false,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
    this.from = config.mail.from;
  }

  async send(to: string, subject: string, text: string): Promise<{ messageId: string }> {
    const info = (await this.transport.sendMail({ from: this.from, to, subject, text })) as {
      messageId: string;
    };
    return { messageId: info.messageId };
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
