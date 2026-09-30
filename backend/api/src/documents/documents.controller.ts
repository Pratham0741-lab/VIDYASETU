import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { requireReason } from '../common/reason';
import type { Response } from 'express';
import type { Actor } from '../auth/actor';
import { CurrentActor, Roles } from '../auth/decorators';
import { AppRole, REVIEWER_ROLES } from '../auth/roles';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { ConfirmDocumentDto, UploadDocumentDto } from './documents.dto';
import { DocumentsService } from './documents.service';
import { LogDocumentAccess } from './document-access';
import { RateLimit } from '../common/throttle/rate-limit';

type Primitive = string | number | boolean;

const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};
const extensionFor = (mime: string) => EXTENSIONS[mime] ?? '';

/** The multer (memory storage) fields this controller uses. */
interface UploadedFileBuffer {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

function validCorrections(input: Record<string, unknown> | undefined): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  const bad: string[] = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    const ok =
      (typeof v === 'string' && v.length <= 500) ||
      (typeof v === 'number' && Number.isFinite(v)) ||
      typeof v === 'boolean';
    if (ok) out[k] = v;
    else bad.push(k);
  }
  if (bad.length > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      details: bad.map((k) => ({
        field: `corrections.${k}`,
        constraints: { primitive: 'must be a string (<= 500 chars), number or boolean' },
      })),
    });
  }
  return out;
}

@ApiTags('documents')
@ApiBearerAuth()
@Controller('api/v1')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * The applicant uploads a file for one checklist slot. Stored and
   * quality-checked synchronously: 200 QUALITY_REJECTED with the issues
   * ("retake"), or 202 PROCESSING with the document id to poll.
   * Phase 10: or, instead of a file, a DigiLocker reference: verified
   * synchronously with the issuer (no OCR pipeline) - 200 DIGILOCKER_VERIFIED,
   * or 422 DIGILOCKER_DOCUMENT_NOT_FOUND / DIGILOCKER_CONSENT_REQUIRED /
   * DIGILOCKER_DOCUMENT_TYPE_MISMATCH.
   */
  @Post('applications/:id/documents')
  @Roles(AppRole.APPLICANT)
  @RateLimit('UPLOAD')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['document_type'],
      properties: {
        file: { type: 'string', format: 'binary' },
        document_type: { type: 'string' },
        digilocker_reference: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary:
      'Upload a document for a checklist slot (jpeg / png / pdf), or give its DigiLocker reference.',
  })
  async upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedFileBuffer | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.digilocker_reference !== undefined) {
      if (file) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, {
          details: [
            {
              field: 'digilocker_reference',
              constraints: { exclusive: 'give either a file or a DigiLocker reference, not both' },
            },
          ],
        });
      }
      res.status(200);
      return this.documents.uploadFromDigiLocker(id, dto.document_type, dto.digilocker_reference);
    }
    if (!file) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [
          {
            field: 'file',
            constraints: { required: 'a file (or a digilocker_reference) is required' },
          },
        ],
      });
    }
    const result = await this.documents.upload(id, {
      slot: dto.document_type,
      fileName: file.originalname,
      contentType: file.mimetype,
      buffer: file.buffer,
    });
    res.status(result.status === 'PROCESSING' ? 202 : 200);
    return result;
  }

  @Get('applications/:id/documents')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @LogDocumentAccess('LIST', 'application_documents')
  @ApiOperation({ summary: 'Checklist, documents, per-field confidence and flags.' })
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.list(id);
  }

  /**
   * The applicant's "documents are in" step (idempotent; the portal calls it
   * after each scan settles). An application submitted to await its
   * documents leaves SUBMITTED through the automatic eligibility gate once
   * nothing is left to upload or scan; returns readiness only, no field values.
   */
  @Post('applications/:id/documents/complete')
  @Roles(AppRole.APPLICANT)
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Move an application awaiting its documents on, once they are all uploaded and scanned.',
  })
  complete(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.complete(id);
  }

  @Get('documents/:id')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @LogDocumentAccess('VIEW', 'document')
  @ApiOperation({ summary: 'One document and its processing state (for polling).' })
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.documents.get(id);
  }

  /**
   * Phase 17.2: the stored file, streamed from object storage (never held in
   * memory). Same visibility as GET /documents/:id (RLS: the owner and
   * reviewers in jurisdiction; 404 otherwise, recorded as a denial). Least
   * privilege: not AUDITOR, COMMITTEE or SUPER_ADMIN. Every view is logged
   * (document_access_log, in the request's transaction; no log row, no file).
   * The file is shown inline in a sandbox: it may not run script, navigate or
   * be sniffed as another type, and is never cached.
   */
  @Get('documents/:id/file')
  @Roles(AppRole.APPLICANT, ...REVIEWER_ROLES)
  @RateLimit('FILE')
  @LogDocumentAccess('VIEW', 'document_file')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', 'sandbox')
  @ApiOperation({
    summary: 'The stored file of one document (JPEG, PNG, WebP or PDF), streamed inline.',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  @ApiOkResponse({
    description: 'The file bytes; Content-Type is the stored type.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'The stored type is not served (details.reason document_type_not_served, details.message_key document.file.unsupported_type).',
  })
  async file(@Param('id', new ParseUUIDPipe()) id: string): Promise<StreamableFile> {
    const f = await this.documents.file(id);
    return new StreamableFile(f.stream, {
      type: f.mime_type,
      // The file's own name is user input: never put it in a header.
      disposition: `inline; filename="document-${f.id}${extensionFor(f.mime_type)}"`,
    });
  }

  @Post('documents/:id/confirm')
  @Roles(...REVIEWER_ROLES)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Officer confirms a needs-review extraction, optionally correcting fields.',
  })
  confirm(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmDocumentDto,
  ) {
    const corrections = validCorrections(dto.corrections);
    // Changing an extracted value is an override: a reason is required. A
    // plain confirmation of the values as read needs none.
    const reason =
      Object.keys(corrections).length > 0
        ? requireReason(dto.remarks, 'remarks')
        : dto.remarks?.trim() || undefined;
    return this.documents.confirm(actor, id, corrections, reason);
  }
}
