import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Injectable } from '@nestjs/common';
import { Client } from 'minio';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-code.enum';
import { AppConfigService } from '../config/app-config.service';

/** Content types accepted for upload, each with its file signature. */
export const ALLOWED_CONTENT_TYPES: Readonly<Record<string, (b: Buffer) => boolean>> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'application/pdf': (b) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
};

/**
 * Content types accepted for documents an ISSUER provides through an
 * integration (Phase 10: DigiLocker's issued-document XML). Deliberately a
 * separate list: applicant uploads stay limited to ALLOWED_CONTENT_TYPES.
 */
export const ISSUED_CONTENT_TYPES: Readonly<Record<string, (b: Buffer) => boolean>> = {
  'application/xml': (b) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '<?xml',
};

export interface StoredObject {
  bucket: string;
  key: string;
  sha256: string;
  size: number;
  contentType: string;
}

/**
 * MinIO (S3-compatible) object storage access.
 * The documents bucket is created by the minio-init container, not here.
 *
 * No presigned URLs: the api proxies every upload and download. It must see
 * the bytes anyway (hash, content sniffing, the synchronous quality check),
 * and downloads must pass the caller's jurisdiction scope and RLS, which a
 * direct browser-to-MinIO URL would bypass.
 */
@Injectable()
export class StorageService {
  readonly client: Client;
  readonly documentsBucket: string;
  private readonly maxBytes: number;

  constructor(config: AppConfigService) {
    const { endPoint, port, useSSL, accessKey, secretKey, documentsBucket } = config.storage;
    this.client = new Client({ endPoint, port, useSSL, accessKey, secretKey });
    this.documentsBucket = documentsBucket;
    this.maxBytes = config.documents.maxUploadBytes;
  }

  /** Readiness probe: true when the documents bucket exists and is reachable. */
  async documentsBucketExists(): Promise<boolean> {
    return this.client.bucketExists(this.documentsBucket);
  }

  /**
   * Validates the declared content type against the allowlist AND the bytes'
   * actual signature (a declared type can lie), enforces the size limit,
   * hashes the content and uploads it.
   */
  async put(
    bucket: string,
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    return this.putChecked(ALLOWED_CONTENT_TYPES, bucket, key, buffer, contentType);
  }

  /**
   * Stores a document an issuer provided through an integration (not an
   * applicant upload): the same size limit, signature check, hashing and
   * storage, against ISSUED_CONTENT_TYPES instead of the upload allowlist.
   */
  async putIssued(
    bucket: string,
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    return this.putChecked(ISSUED_CONTENT_TYPES, bucket, key, buffer, contentType);
  }

  private async putChecked(
    allowed: Readonly<Record<string, (b: Buffer) => boolean>>,
    bucket: string,
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const matchesSignature = Object.prototype.hasOwnProperty.call(allowed, contentType)
      ? allowed[contentType]
      : undefined;
    if (!matchesSignature) {
      throw new AppError(ErrorCode.UNSUPPORTED_MEDIA_TYPE, {
        details: { allowed: Object.keys(allowed) },
      });
    }
    if (buffer.length === 0) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, {
        details: [{ field: 'file', constraints: { notEmpty: 'The file is empty.' } }],
      });
    }
    if (buffer.length > this.maxBytes) {
      throw new AppError(ErrorCode.PAYLOAD_TOO_LARGE, {
        details: { max_bytes: this.maxBytes, size: buffer.length },
      });
    }
    if (!matchesSignature(buffer)) {
      throw new AppError(ErrorCode.UNSUPPORTED_MEDIA_TYPE, {
        message: 'The file content does not match its declared type.',
        details: { declared: contentType },
      });
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    try {
      await this.client.putObject(bucket, key, buffer, buffer.length, {
        'Content-Type': contentType,
        'X-Amz-Meta-Sha256': sha256,
      });
    } catch (err) {
      throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
        details: { service: 'storage', operation: 'put' },
        cause: err,
      });
    }
    return { bucket, key, sha256, size: buffer.length, contentType };
  }

  /**
   * Phase 17.2: the object as a stream, for serving a file without holding it
   * in memory (GET /documents/:id/file). Errors opening it map as in get();
   * the stream itself is the MinIO response body, piped to the client.
   */
  async getStream(bucket: string, key: string): Promise<Readable> {
    try {
      return await this.client.getObject(bucket, key);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NoSuchKey' || code === 'NotFound') throw new AppError(ErrorCode.NOT_FOUND);
      throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
        details: { service: 'storage', operation: 'get' },
        cause: err,
      });
    }
  }

  /** The object's bytes. */
  async get(bucket: string, key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(bucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NoSuchKey' || code === 'NotFound') throw new AppError(ErrorCode.NOT_FOUND);
      throw new AppError(ErrorCode.DEPENDENCY_UNAVAILABLE, {
        details: { service: 'storage', operation: 'get' },
        cause: err,
      });
    }
  }
}
