import { Button, Card, Icon, ScreenTitle, Tag } from "../../ui";

export default function VerificationScreen() {
  const checks = [
    ["Name across documents", "Ram Kumar / R. Kumar / राम कुमार", "98% match", "Fuzzy match verified"],
    ["Date of birth", "14 August 2001", "Exact match", "Present on 3 documents"],
    ["Income certificate validity", "Issued 18 June 2026", "Valid", "Within required 12 months"],
  ];
  return <main className="app-page">
    <ScreenTitle eyebrow="Application verification" title="Review your verified details" description="We’ve compared your DigiLocker records and uploaded documents. Confirm these details before continuing." action={<Button variant="secondary" icon="refresh">Sync again</Button>} />
    <div className="sync-banner"><div className="digilocker-mark"><Icon name="lock" /></div><div><strong>DigiLocker connected</strong><p>Last synced today at 11:42 AM · 3 documents pre-verified</p></div><Tag tone="green"><Icon name="check" /> Connected</Tag></div>
    <div className="verification-grid">
      <Card><div className="card-heading"><div><span className="eyebrow">Cross-document consistency</span><h2>All key details are consistent</h2><p>AI-assisted checks compare your records while accounting for initials, spelling variants, and Indian scripts.</p></div><div className="score-ring">96<small>%</small></div></div>
        <div className="check-table">{checks.map(([label, value, status, detail]) => <div className="check-row" key={label}><span className="rule-check"><Icon name="check" /></span><div><small>{label}</small><strong>{value}</strong></div><div><Tag tone="green">{status}</Tag><small>{detail}</small></div></div>)}</div>
        <div className="human-note"><Icon name="user" /><div><strong>What happens next?</strong><p>An assigned officer will review the original records. AI matching supports review; it never replaces the final human decision.</p></div></div>
      </Card>
      <Card className="documents-card"><h3>Verified documents</h3>{["Income certificate", "ST certificate", "MA degree certificate"].map((doc, i) => <div className="doc-row" key={doc}><Icon name="document" /><div><strong>{doc}</strong><small>{i === 1 ? "Uploaded document" : "From DigiLocker"}</small></div><Icon name="check" /></div>)}<Button variant="secondary">View document details</Button></Card>
    </div>
  </main>;
}
