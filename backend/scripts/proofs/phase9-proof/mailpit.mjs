// Reads Mailpit's real API (http://127.0.0.1:8025): list, then full text of matching messages.
const filter = process.argv[2] ?? '';
const list = await (await fetch('http://127.0.0.1:8025/api/v1/messages?limit=200')).json();
console.log(`Mailpit: ${list.total} message(s) total`);
for (const m of [...list.messages].reverse()) {
  const to = m.To.map((t) => t.Address).join(',');
  if (filter && !to.includes(filter) && !m.Subject.includes(filter)) continue;
  const full = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${m.ID}`)).json();
  console.log(`\n--- From: ${full.From.Address}  To: ${to}\n    Subject: ${m.Subject}\n${full.Text.trimEnd().split('\n').map((l) => '    | ' + l).join('\n')}`);
}
