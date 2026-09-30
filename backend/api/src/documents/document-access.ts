import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Global,
  Injectable,
  Module,
  NestInterceptor,
  Query,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { Observable, from, mergeMap } from 'rxjs';
import type { Actor } from '../auth/actor';
import { Roles } from '../auth/decorators';
import { DENIAL_READER_ROLES } from '../authorization-denials/authorization-denials.controller';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { requestIdOf } from '../common/middleware/request-id.middleware';
import { DbContext } from '../database/db-context';
export { DOCUMENT_ACCESS_ROUTES } from './document-access-routes';

/**
 * Phase 17 (Part E): document views, downloads and crop views are logged -
 * who (account and role), which document / resource, when, through which
 * route. Ids only, never content or personal data.
 *
 * One row per SUCCESSFUL response, written in the request's own actor
 * transaction after the handler returns: if the row cannot be written the
 * response fails (a view is never served unlogged). Refused accesses are
 * authorization denials (DOCUMENT_ACCESS_ROUTES in the denial classifier),
 * not rows here.
 */
export type AccessKind = 'LIST' | 'VIEW' | 'CROP' | 'DOWNLOAD';
export type AccessResource =
  | 'application_documents'
  | 'document'
  | 'document_file'
  | 'deficiency_item_crop'
  | 'sanction_order'
  | 'sanction_order_pdf';

export interface AccessSpec {
  kind: AccessKind;
  resource: AccessResource;
}

const ACCESS_LOG = 'vidyasetu:document-access';

@Injectable()
export class DocumentAccessService {
  constructor(private readonly db: DbContext) {}

  /** Writes the access row; throws unless exactly one row was written. */
  async record(spec: AccessSpec, req: Request, actor: Actor): Promise<void> {
    const routePath = (req as { route?: { path?: unknown } }).route?.path;
    const route = `${req.method} ${req.baseUrl ?? ''}${typeof routePath === 'string' ? routePath : ''}`;
    const p = req.params as Record<string, string>;
    const requestId = requestIdOf(req);
    const client = this.db.client;
    let n = 0;
    // The application (and document) are read in the same transaction the
    // view just succeeded in, so they are visible to this actor. No
    // RETURNING: an applicant may insert its row but not read it back.
    switch (spec.resource) {
      case 'application_documents':
        n = await client.$executeRaw`
          INSERT INTO document_access_log (actor_account_id, actor_role, access_kind, resource_type,
            resource_id, application_id, document_id, route, request_id, jurisdiction_state, jurisdiction_district)
          SELECT ${actor.accountId}::uuid, ${actor.role}, ${spec.kind}, ${spec.resource},
                 a.id, a.id, NULL, ${route}, ${requestId}, a.jurisdiction_state, a.jurisdiction_district
            FROM applications a WHERE a.id = ${p.id}::uuid`;
        break;
      case 'document':
      case 'document_file':
        n = await client.$executeRaw`
          INSERT INTO document_access_log (actor_account_id, actor_role, access_kind, resource_type,
            resource_id, application_id, document_id, route, request_id, jurisdiction_state, jurisdiction_district)
          SELECT ${actor.accountId}::uuid, ${actor.role}, ${spec.kind}, ${spec.resource},
                 d.id, a.id, d.id, ${route}, ${requestId}, a.jurisdiction_state, a.jurisdiction_district
            FROM documents d JOIN applications a ON a.id = d.application_id WHERE d.id = ${p.id}::uuid`;
        break;
      case 'deficiency_item_crop':
        n = await client.$executeRaw`
          INSERT INTO document_access_log (actor_account_id, actor_role, access_kind, resource_type,
            resource_id, application_id, document_id, route, request_id, jurisdiction_state, jurisdiction_district)
          SELECT ${actor.accountId}::uuid, ${actor.role}, ${spec.kind}, ${spec.resource},
                 i.id, a.id, NULLIF(i.crop_ref->>'document_id', '')::uuid, ${route}, ${requestId},
                 a.jurisdiction_state, a.jurisdiction_district
            FROM deficiency_items i JOIN applications a ON a.id = i.application_id
           WHERE i.id = ${p.itemId}::uuid AND a.id = ${p.id}::uuid`;
        break;
      case 'sanction_order':
      case 'sanction_order_pdf':
        n = await client.$executeRaw`
          INSERT INTO document_access_log (actor_account_id, actor_role, access_kind, resource_type,
            resource_id, application_id, document_id, route, request_id, jurisdiction_state, jurisdiction_district)
          SELECT ${actor.accountId}::uuid, ${actor.role}, ${spec.kind}, ${spec.resource},
                 s.id, a.id, NULL, ${route}, ${requestId}, a.jurisdiction_state, a.jurisdiction_district
            FROM sanction_orders s JOIN applications a ON a.id = s.application_id WHERE s.id = ${p.id}::uuid`;
        break;
    }
    // Fail closed: a view is never served without its log row.
    if (n !== 1) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, {
        details: { reason: 'document_access_not_logged', resource_type: spec.resource },
      });
    }
  }

  /** The rows visible to the caller (jurisdiction RLS), newest first. */
  async list(q: DocumentAccessQueryDto) {
    const accesses = await this.db.client.documentAccessLog.findMany({
      where: {
        ...(q.document_id ? { document_id: q.document_id } : {}),
        ...(q.application_id ? { application_id: q.application_id } : {}),
      },
      orderBy: [{ accessed_at: 'desc' }, { id: 'desc' }],
      take: q.limit ?? 50,
    });
    return { accesses };
  }
}

type RequestWithActor = Request & { actor?: Actor };

@Injectable()
export class DocumentAccessInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: DocumentAccessService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<AccessSpec | undefined>(ACCESS_LOG, context.getHandler());
    const req = context.switchToHttp().getRequest<RequestWithActor>();
    const actor = req.actor;
    if (!spec || !actor) return next.handle();
    return next
      .handle()
      .pipe(
        mergeMap((body: unknown) => from(this.access.record(spec, req, actor).then(() => body))),
      );
  }
}

/** Marks a route whose successful responses are logged in document_access_log. */
export const LogDocumentAccess = (kind: AccessKind, resource: AccessResource) =>
  applyDecorators(
    SetMetadata(ACCESS_LOG, { kind, resource } satisfies AccessSpec),
    UseInterceptors(DocumentAccessInterceptor),
  );

export class DocumentAccessQueryDto {
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() document_id?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() application_id?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

/** Who viewed which document: the jurisdiction's readers (as for denials); ids only. */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('api/v1/document-access')
export class DocumentAccessController {
  constructor(private readonly access: DocumentAccessService) {}

  @Get()
  @Roles(...DENIAL_READER_ROLES)
  @ApiOperation({ summary: 'Document views and downloads in my jurisdiction, newest first.' })
  list(@Query() q: DocumentAccessQueryDto) {
    return this.access.list(q);
  }
}

/**
 * Global: the interceptor is instantiated in every module whose controllers
 * use @LogDocumentAccess (documents, deficiencies, post-selection).
 */
@Global()
@Module({
  controllers: [DocumentAccessController],
  providers: [DocumentAccessService, DocumentAccessInterceptor],
  exports: [DocumentAccessService, DocumentAccessInterceptor],
})
export class DocumentAccessModule {}
