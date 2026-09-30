import { DEVANAGARI, devanagariAvailable, fontFor } from './fonts';

describe('PDF fonts (Phase 17, F4)', () => {
  const doc = () => {
    const registered: string[] = [];
    return { registered, registerFont: (name: string) => registered.push(name) };
  };

  it('detects Devanagari text, and only that', () => {
    expect(
      ['राँची', 'रिंकी टोप्पो', 'Ranchi ।', 'NFST (फ़ेलोशिप)'].every((s) => DEVANAGARI.test(s)),
    ).toBe(true);
    expect(
      ['Ranchi', '<5', 'suppressed', 'VS-2026-27-2BDB3F5A58', ''].some((s) => DEVANAGARI.test(s)),
    ).toBe(false);
  });

  it('ASCII text keeps the built-in font and registers nothing (byte-stable PDFs)', () => {
    const d = doc();
    expect(fontFor(d, 'Ranchi', 'Helvetica')).toBe('Helvetica');
    expect(fontFor(d, 'Ranchi', 'Helvetica-Bold')).toBe('Helvetica-Bold');
    expect(d.registered).toEqual([]);
  });

  it('Devanagari text uses the embedded font, registered once per document', () => {
    const d = doc();
    const regular = fontFor(d, 'राँची', 'Helvetica');
    const bold = fontFor(d, 'दुमका', 'Helvetica-Bold');
    if (devanagariAvailable()) {
      // One weight: bold Devanagari text is drawn regular.
      expect([regular, bold]).toEqual(['Devanagari', 'Devanagari']);
      expect(d.registered).toEqual(['Devanagari']);
    } else {
      // A bare checkout has no font files (the image build installs them): fall back.
      expect([regular, bold]).toEqual(['Helvetica', 'Helvetica-Bold']);
    }
  });
});
