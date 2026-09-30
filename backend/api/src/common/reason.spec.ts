import { AppError } from './errors/app-error';
import { ErrorCode } from './errors/error-code.enum';
import { REASON_MIN_LENGTH, requireReason } from './reason';

describe('requireReason (Phase 13B)', () => {
  it('returns the trimmed reason', () => {
    expect(requireReason('  Income certificate expired  ', 'remarks')).toBe(
      'Income certificate expired',
    );
  });

  it.each([undefined, null, '', '   ', 'too short', ' 123456789 ', 42])(
    'refuses %p with REASON_REQUIRED and the field',
    (value) => {
      try {
        requireReason(value, 'notes');
        throw new Error('expected a refusal');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.REASON_REQUIRED);
        expect((err as AppError).details).toEqual({
          field: 'notes',
          min_length: REASON_MIN_LENGTH,
          max_length: 2000,
        });
      }
    },
  );

  it('accepts exactly the minimum after trimming, and honours a custom maximum', () => {
    expect(requireReason(' 1234567890 ', 'remarks')).toBe('1234567890');
    expect(() => requireReason('x'.repeat(2001), 'remarks')).toThrow(AppError);
    expect(requireReason('x'.repeat(3000), 'note', 4000)).toHaveLength(3000);
  });
});
