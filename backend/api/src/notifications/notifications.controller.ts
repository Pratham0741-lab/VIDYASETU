import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { ALL_ROLES, ALL_WRITING_ROLES } from '../auth/roles';
import { NotificationsService } from './notifications.service';

export class NotificationsQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: 'true' | 'false';
}

/**
 * The caller's own in-app notifications. Every row has one recipient
 * account, so scoping is exactly "recipient = the authenticated caller"
 * (from the verified token, never from input): no jurisdiction logic.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles(...ALL_ROLES)
  @ApiOperation({ summary: 'My in-app notifications, newest first.' })
  list(@CurrentActor() actor: Actor, @Query() query: NotificationsQueryDto) {
    return this.notifications.list(actor.accountId, query.unread === 'true');
  }

  @Post(':id/read')
  // A write (marks the notification read): every role except the read-only AUDITOR.
  @Roles(...ALL_WRITING_ROLES)
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one of my notifications as read.' })
  markRead(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.markRead(actor.accountId, id);
  }
}
