import { AppError } from '../common/errors/app-error';
import type { AppConfigService } from '../config/app-config.service';
import { StorageService } from './storage.service';

const config = {
  storage: {
    endPoint: 'localhost',
    port: 9000,
    useSSL: false,
    accessKey: 'a',
    secretKey: 'bbbbbbbb',
    documentsBucket: 'documents',
  },
  documents: { maxUploadBytes: 1024 * 1024 },
} as unknown as AppConfigService;
const XML = Buffer.from('<?xml version="1.0"?><Certificate/>');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function build() {
  const s = new StorageService(config);
  const putObject = jest
    .spyOn(s.client, 'putObject')
    .mockResolvedValue({ etag: 'e', versionId: null });
  return { s, putObject };
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => 'stored',
    (e: unknown) => (e instanceof AppError ? e.code : String(e)),
  );

describe('StorageService: applicant uploads vs issuer documents', () => {
  it('applicant upload (put) still refuses XML - the upload allowlist is unchanged', async () => {
    const { s, putObject } = build();
    expect(await code(s.put('documents', 'k', XML, 'application/xml'))).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expect(await code(s.put('documents', 'k', PNG, 'image/png'))).toBe('stored');
    expect(putObject).toHaveBeenCalledTimes(1);
  });

  it('issuer document (putIssued) accepts only XML whose bytes really are XML', async () => {
    const { s } = build();
    expect(await code(s.putIssued('documents', 'k', XML, 'application/xml'))).toBe('stored');
    expect(await code(s.putIssued('documents', 'k', PNG, 'image/png'))).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
    expect(await code(s.putIssued('documents', 'k', PNG, 'application/xml'))).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });
});
