import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Phase 17 (F4): PDFs can draw Hindi. The built-in PDF fonts (Helvetica)
 * have no Devanagari glyphs, so any text containing Devanagari is drawn with
 * Lohit Devanagari (SIL Open Font License 1.1), which the image build
 * installs into /app/fonts (Dockerfile stage `fonts`; nothing is fetched at
 * runtime). It also has every printable ASCII glyph, so a string mixing Hindi
 * and English renders whole; it has one weight, so Devanagari text is never
 * bold. Text without Devanagari keeps the built-in fonts, so an ASCII PDF is
 * byte-for-byte what it was before. The font is registered with a document
 * only when that document first needs it.
 */

/** Any character used in Devanagari text (Unicode script extensions: letters, signs, dandas). */
export const DEVANAGARI = /\p{Script_Extensions=Devanagari}/u;

/** /app/fonts in the image (the working directory is /app). */
export const FONT_DIR = join(process.cwd(), 'fonts');
const FILE = 'Lohit-Devanagari.ttf';
const NAME = 'Devanagari';

interface FontDoc {
  registerFont(name: string, src: string): unknown;
}

const registered = new WeakSet<object>();

/** True when the Devanagari font file is present (always in the image). */
export function devanagariAvailable(): boolean {
  return existsSync(join(FONT_DIR, FILE));
}

/**
 * The font to draw `text` with: the built-in one unless the text contains
 * Devanagari. Without the font file (a bare checkout) it falls back to the
 * built-in font, as before Phase 17.
 */
export function fontFor(doc: FontDoc, text: string, base: 'Helvetica' | 'Helvetica-Bold'): string {
  if (!DEVANAGARI.test(text) || !devanagariAvailable()) return base;
  if (!registered.has(doc)) {
    doc.registerFont(NAME, join(FONT_DIR, FILE));
    registered.add(doc);
  }
  return NAME;
}
