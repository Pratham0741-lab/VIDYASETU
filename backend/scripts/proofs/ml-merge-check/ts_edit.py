from pathlib import Path

def edit(path, pairs):
    p = Path(path)
    s = p.read_text(encoding='utf8')
    for old, new in pairs:
        assert old in s, (path, old[:60])
        s = s.replace(old, new, 1)
    p.write_text(s, encoding='utf8', newline='\n')
    print('edited', path)

# 1. review-routing: compare against the slot's canonical type; empty checks -> UNCERTAIN.
edit('src/documents/review-routing.ts', [
    ('''  classification: { type: string; confidence: number },
  slot: string,
): Routing {''', '''  classification: { type: string; confidence: number },
  /** The slot's canonical document type (document-types.ts); null = none. */
  expectedType: string | null,
): Routing {'''),
    ('''  if (classification.type !== slot) {
    reasons.push('classified document type differs from the uploaded slot');''', '''  if (expectedType === null) {
    reasons.push('the uploaded slot has no canonical document type, so classification cannot confirm it');
  } else if (classification.type !== expectedType) {
    reasons.push('classified document type differs from the uploaded slot');'''),
    ('''  const keys = Object.keys(value);
  if (keys.some((k) => (confidence[k] ?? 0) < minConfidence)) return 'UNCERTAIN';''', '''  const keys = Object.keys(value);
  // No checks at all (nothing comparable) is "cannot tell", never CONSISTENT
  // (Array.every on an empty list is vacuously true).
  if (keys.length === 0) return 'UNCERTAIN';
  if (keys.some((k) => (confidence[k] ?? 0) < minConfidence)) return 'UNCERTAIN';'''),
])

# 2. processor: send the canonical type (or none); compare canonically.
edit('src/documents/document-pipeline.processor.ts', [
    ('''    let classification: Awaited<ReturnType<MlClientService['classifyDocument']>>;''',
     '''    const expectedType = canonicalTypeForSlot(job.slot);
    let classification: Awaited<ReturnType<MlClientService['classifyDocument']>>;'''),
    ('''      extraction = await this.ml.extractFields(image, job.slot);''',
     '''      extraction = await this.ml.extractFields(image, expectedType);'''),
    ('''      { type: classification.value, confidence: classification.confidence },
      job.slot,
    );''', '''      { type: classification.value, confidence: classification.confidence },
      expectedType,
    );'''),
    ('''          classification_matches_slot: classification.value === job.slot,''',
     '''          classification_matches_slot: expectedType !== null && classification.value === expectedType,'''),
    ('''import { SystemTransactionRunner } from '../database/system-transaction.runner';''',
     '''import { SystemTransactionRunner } from '../database/system-transaction.runner';
import { canonicalTypeForSlot } from './document-types';'''),
])

# 3. ml client: document_type is a canonical type, omitted when unknown.
edit('src/ml-client/ml-client.service.ts', [
    ('''  extractFields(image: Buffer, documentType: string): Promise<ExtractionResult> {
    return this.document('extract', {
      image_base64: image.toString('base64'),
      document_type: documentType,
    });''', '''  /** documentType: a canonical type, or null to let the ml service classify. */
  extractFields(image: Buffer, documentType: string | null): Promise<ExtractionResult> {
    return this.document('extract', {
      image_base64: image.toString('base64'),
      ...(documentType === null ? {} : { document_type: documentType }),
    });'''),
])
edit('src/ml-client/document-api.ts', [
    (''' *   /v1/documents/extract      { image_base64, document_type }   -> ExtractionResult
 *   /v1/documents/consistency  { extractions }                   -> ConsistencyResult
 * The ml service does not implement these yet; with ML_MODE=mock the same
 * interface is served by MockMlService from documented fixtures.
 */''', ''' *   /v1/documents/extract      { image_base64, document_type? }  -> ExtractionResult
 *   /v1/documents/consistency  { extractions }                   -> ConsistencyResult
 * document_type and the classifier's `value` are canonical document types
 * (INCOME_CERTIFICATE, CASTE_CERTIFICATE, ... - see
 * src/documents/document-types.ts), never checklist slot text. Implemented by
 * the ml service (ml/app/routes); with ML_MODE=mock the same interface is
 * served by MockMlService from documented fixtures.
 */'''),
])

# 4. mock: return canonical types like the real service; accept a null type.
edit('src/ml-client/mock-ml.service.ts', [
    ('''    const type = fx.params.type ?? 'unknown_document';''',
     '''    // Canonical type, like the real classifier (a fixture may name a slot).
    const type = fx.params.type
      ? (canonicalTypeForSlot(fx.params.type) ?? fx.params.type)
      : 'unknown_document';'''),
    ('''  override extractFields(image: Buffer, documentType: string): Promise<ExtractionResult> {
    const fx = readMockFixture(image);
    const fields = fieldsFor(documentType);''', '''  override extractFields(image: Buffer, documentType: string | null): Promise<ExtractionResult> {
    const fx = readMockFixture(image);
    const fields = fieldsFor(documentType ?? '');'''),
    ('''import { MlClientService } from './ml-client.service';''',
     '''import { canonicalTypeForSlot } from '../documents/document-types';
import { MlClientService } from './ml-client.service';'''),
])
