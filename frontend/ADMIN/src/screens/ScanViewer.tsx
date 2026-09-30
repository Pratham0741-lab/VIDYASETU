import { useEffect, useRef, useState } from "react";
import * as ep from "../api/endpoints";
import type { DocumentView } from "../api/responses";
import { useI18n } from "../i18n";
import { Action, ErrorNote, Icon, Loading, useRunner } from "../ui";

const ZOOMS = [50, 75, 100, 125, 150, 200, 300] as const;
const PDF = "application/pdf";

/**
 * The original uploaded file, from GET /documents/:id/file (reviewer roles in
 * jurisdiction). The route needs the bearer token, so the file is fetched
 * through the API client as a Blob and shown from an object URL. Nothing is
 * fetched until the viewer is opened; the Blob is kept for the current
 * document only, and its URL is revoked when the document changes or the
 * viewer unmounts. The Blob and the URL are never logged.
 */
export default function ScanViewer({ doc }: { doc: DocumentView }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(100);
  const urlRef = useRef<string | null>(null);
  const runner = useRunner();
  const digilocker = doc.source === "DIGILOCKER";

  const revoke = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };
  // A new document (the parent keys this component by document id) or unmount: release the file.
  useEffect(() => revoke, []);

  const load = () => {
    setOpen(true);
    if (file) return; // cached for this document
    void runner.run(async () => {
      const blob = await ep.getDocumentFile(doc.document_id);
      revoke();
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setFile({ url, type: blob.type || doc.mime_type });
    });
  };

  if (digilocker) return <div className="muted scan-note">{t("scan.digilocker")}</div>;
  return <div className="scan-viewer">
    <div className="scan-toolbar">
      <strong>{t("scan.title")}</strong>
      {!open && <Action icon="eye" onClick={load}>{t("scan.open")}</Action>}
      {open && file && !file.type.startsWith(PDF) && <div className="scan-zoom" role="group" aria-label={t("scan.zoom")}>
        <Action variant="ghost" disabled={zoom === ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>−</Action>
        <span>{zoom}%</span>
        <Action variant="ghost" disabled={zoom === ZOOMS[ZOOMS.length - 1]} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}>+</Action>
        <Action variant="ghost" onClick={() => setZoom(100)}>{t("scan.fit")}</Action>
      </div>}
      {open && <Action variant="ghost" onClick={() => setOpen(false)}>{t("scan.hide")}</Action>}
    </div>
    {open && <>
      {runner.busy && <Loading />}
      <ErrorNote error={runner.error} />
      {runner.error != null && <Action icon="refresh" onClick={() => { runner.setError(null); load(); }}>{t("common.retry")}</Action>}
      {file && (file.type.startsWith(PDF)
        ? <iframe className="scan-pdf" title={t("scan.title")} src={file.url} sandbox="" referrerPolicy="no-referrer" />
        : <div className="scan-frame"><img src={file.url} alt={t("scan.alt", { type: doc.document_type })} style={{ width: `${zoom}%` }} /></div>)}
      {file && <div className="muted scan-note"><Icon name="lock" size={12} /> {t("scan.note")}</div>}
    </>}
  </div>;
}
