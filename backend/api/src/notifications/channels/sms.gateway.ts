import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

/**
 * SMS delivery port. Adapter pattern for external gateways (the same shape
 * planned for DigiLocker / PFMS / NSP): the interface is what the rest of
 * the api depends on; a real gateway is a new implementation bound in
 * NotificationsModule. Only the mock exists - no real SMS gateway is built.
 */
export abstract class SmsGateway {
  abstract send(to: string, text: string): Promise<{ messageId: string }>;
}

/** MOCK SMS: nothing leaves the process. Logs the recipient's last 4 digits only. */
@Injectable()
export class MockSmsGateway extends SmsGateway {
  private sent = 0;

  constructor(@InjectPinoLogger('MockSmsGateway') private readonly logger: PinoLogger) {
    super();
  }

  send(to: string, text: string): Promise<{ messageId: string }> {
    this.sent += 1;
    const messageId = `mock-sms-${Date.now()}-${this.sent}`;
    this.logger.info(
      { sms: { to_last4: to.slice(-4), length: text.length, messageId } },
      'MOCK SMS accepted (not delivered)',
    );
    return Promise.resolve({ messageId });
  }
}
