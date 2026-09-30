import { createMlClient } from './ml-client.module';

// The mock is obtained exactly as production obtains it: through the
// module's factory with ML_MODE=mock. No file but ml-client.module.ts
// imports it.
const mock = createMlClient(
  { ml: { baseUrl: 'http://ml:8000', timeoutMs: 1000, mode: 'mock' } } as never,
  { warn: jest.fn() } as never,
);
const file = (marker: string) =>
  Buffer.from(`%PDF-1.4
% VIDYASETU-MOCK-FIXTURE:${marker};END
`);

describe('MOCK ML fixtures (documented scenarios, not real analysis)', () => {
  it('ML_MODE=mock selects the mock; ML_MODE=real the HTTP client', () => {
    expect(mock.engineLabel).toBe('MOCK_ML');
    const real = createMlClient(
      { ml: { baseUrl: 'http://ml:8000', timeoutMs: 1000, mode: 'real' } } as never,
      { warn: jest.fn() } as never,
    );
    expect(real.engineLabel).toBe('ML_SERVICE');
  });

  it('params end at ;END even when printable bytes follow (e.g. a PNG chunk CRC)', async () => {
    const png = Buffer.from(
      'PNG VIDYASETU-MOCK-FIXTURE:clean;caste_cert_number=JH-ST-1;ENDy#9Q',
      'latin1',
    );
    const r = await mock.extractFields(png, 'ST certificate');
    expect(r.value.caste_cert_number).toBe('JH-ST-1');
    const unterminated = Buffer.from('VIDYASETU-MOCK-FIXTURE:quality_failyQ#;caste=x', 'latin1');
    expect((await mock.checkQuality(unterminated)).value.usable).toBe(false);
    expect((await mock.extractFields(unterminated, 'ST certificate')).value.caste_cert_number).toBe(
      'MOCK-ST-0001',
    );
  });

  it('reads URL-encoded params from the marker in the file bytes', async () => {
    const r = await mock.extractFields(
      file('clean;holder_name=Kavya%20Oraon;family_income_annual=900000'),
      'Family Income Certificate',
    );
    expect(r.value).toMatchObject({ holder_name: 'Kavya Oraon', family_income_annual: 900000 });
    const c = await mock.classifyDocument(file('clean;type=Family%20Income%20Certificate'));
    // Canonical type, like the real classifier - never the slot text.
    expect([c.value, c.confidence]).toEqual(['INCOME_CERTIFICATE', 0.95]);
  });

  it('clean: every field confidence > 0.9', async () => {
    const r = await mock.extractFields(file('clean'), 'Family Income Certificate');
    expect(Math.min(...Object.values(r.confidence))).toBeGreaterThan(0.9);
    expect(r.raw_text).toContain('MOCK OCR TEXT');
  });

  it('low_confidence_field: exactly the named field is low', async () => {
    const r = await mock.extractFields(
      file('low_confidence_field;low=certificate_number'),
      'Family Income Certificate',
    );
    expect(Object.entries(r.confidence).filter(([, c]) => c < 0.9)).toEqual([
      ['certificate_number', 0.55],
    ]);
  });

  it('quality_fail: usable false with realistic issues', async () => {
    const r = await mock.checkQuality(file('quality_fail'));
    expect(r.value.usable).toBe(false);
    expect(r.value.issues.map((i) => i.split(':')[0])).toEqual([
      'image_blurred',
      'glare_detected',
      'page_cropped',
    ]);
    expect(r.details.mock).toBe(true);
  });

  it('ambiguous_classification: top confidence < 0.6 with real alternatives', async () => {
    const r = await mock.classifyDocument(file('ambiguous_classification;type=marksheet'));
    expect(r.confidence).toBeLessThan(0.6);
    expect(r.alternatives.length).toBeGreaterThan(0);
  });

  it('consistency: match, clean fail, and uncertain (~0.5)', async () => {
    const same = await mock.checkConsistency([
      { holder_name: 'Kavya Oraon' },
      { holder_name: 'KAVYA  ORAON' },
    ]);
    expect(same.value.names_match).toBe(true);
    const fail = await mock.checkConsistency([
      { holder_name: 'Kavya Oraon' },
      { holder_name: 'Sunita Munda' },
    ]);
    expect([fail.value.names_match, fail.confidence.names_match]).toEqual([false, 0.95]);
    const unsure = await mock.checkConsistency([
      { holder_name: 'Kavya Oraon' },
      { holder_name: 'K. Oraon' },
    ]);
    expect([unsure.value.names_match, unsure.confidence.names_match]).toEqual([false, 0.5]);
  });
});
