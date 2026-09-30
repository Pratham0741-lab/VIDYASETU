import { Button, Card, Icon, ScreenTitle, Tag } from "../../ui";

export default function PostAwardScreen() {
  return <main className="app-page">
    <ScreenTitle eyebrow="Post-award hub · Award year 2026–27" title="Your fellowship is active" description="Manage your sanction order, installments, annual renewals, and support requests." action={<Tag tone="green"><Icon name="check" /> Award active</Tag>} />
    <div className="award-grid">
      <Card className="sanction-card"><div className="sanction-copy"><span className="eyebrow">Official sanction order</span><h2>NFST Fellowship Award</h2><p>Order No. 11016/18/2026-Edu<br />Issued 12 November 2026</p><Button icon="download">Download signed PDF</Button><small><Icon name="shield" /> Digitally signed and verifiable</small></div><div className="pdf-preview"><div className="pdf-top"><span>PROTOTYPE</span><span>SAMPLE DATA</span></div><Icon name="shield" size={24} /><strong>SANCTION ORDER</strong><p>National Fellowship for<br />Scheduled Tribe Students</p><i /><i /><i /><span className="stamp">APPROVED</span></div></Card>
      <Card className="payment-card"><div className="card-heading"><div><h2>Installments & PFMS tracking</h2><p>2026–27 payment schedule</p></div><Tag tone="green">On schedule</Tag></div>
        <div className="payment-list"><div className="paid"><span><Icon name="check" /></span><div><strong>Quarter 1 fellowship</strong><small>PFMS Txn: P26NF18492001 · 18 Nov 2026</small></div><b>₹93,000</b></div><div className="processing"><span>2</span><div><strong>Quarter 2 fellowship</strong><small>Sent to PFMS · Expected by 18 Feb 2027</small></div><b>₹93,000</b></div><div><span>3</span><div><strong>Quarter 3 fellowship</strong><small>Scheduled after progress report</small></div><b>₹93,000</b></div></div>
      </Card>
    </div>
    <div className="lower-grid">
      <Card><div className="card-heading"><div><h2>Annual renewal</h2><p>Next renewal due 31 August 2027</p></div><Tag tone="blue">Not yet due</Tag></div><div className="renewal-items"><span><Icon name="check" />Enrollment continuation</span><span><Icon name="check" />Supervisor confirmation</span><span><Icon name="upload" />Annual progress report</span></div><Button variant="secondary">View renewal requirements</Button></Card>
      <Card><div className="card-heading"><div><h2>Grievance desk</h2><p>Secure support with time-bound resolution</p></div><Button variant="secondary">Raise grievance</Button></div><div className="ticket"><Tag tone="amber">In review</Tag><div><strong>#GRV-260184 · Delayed HRA component</strong><small>Assigned to PFMS liaison · Updated yesterday</small></div><div><small>RESOLUTION DUE</small><strong>3 days</strong></div></div></Card>
    </div>
  </main>;
}
