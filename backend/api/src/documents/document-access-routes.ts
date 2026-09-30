/**
 * Phase 17 (Part E): the routes whose successful responses are logged in
 * document_access_log (method + pattern, as Express reports them). A 404 on
 * any of them is recorded as a DOCUMENT_NOT_ACCESSIBLE denial. Kept free of
 * imports: the denial classifier is pure.
 */
export const DOCUMENT_ACCESS_ROUTES: ReadonlySet<string> = new Set([
  'GET /api/v1/applications/:id/documents',
  'GET /api/v1/documents/:id',
  'GET /api/v1/documents/:id/file',
  'GET /api/v1/applications/:id/deficiencies/items/:itemId/crop',
  'GET /api/v1/sanction-orders/:id',
  'GET /api/v1/sanction-orders/:id/pdf',
]);
