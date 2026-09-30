import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { DbContext } from '../database/db-context';

const SELECT = {
  id: true,
  event_type: true,
  template_key: true,
  locale: true,
  application_id: true,
  subject: true,
  body: true,
  created_at: true,
  read_at: true,
} as const;

/**
 * In-app inbox reads. Runs in the caller's actor transaction (DbContext);
 * every query is keyed on the caller's own account id from the verified
 * token, never on input.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbContext) {}

  async list(accountId: string, unreadOnly: boolean) {
    const rows = await this.db.client.notification.findMany({
      where: {
        recipient_account_id: accountId,
        channel: 'IN_APP',
        ...(unreadOnly ? { read_at: null } : {}),
      },
      select: SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return { count: rows.length, notifications: rows };
  }

  async markRead(accountId: string, id: string) {
    const mine = { id, recipient_account_id: accountId, channel: 'IN_APP' };
    const updated = await this.db.client.notification.updateMany({
      where: { ...mine, read_at: null },
      data: { read_at: new Date() },
    });
    if (updated.count === 0 && (await this.db.client.notification.count({ where: mine })) === 0) {
      throw new AppError(ErrorCode.NOT_FOUND);
    }
    return { id, read: true };
  }
}
