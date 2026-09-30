// Phase 13D proof 4 (continued): two more notification types after switching back to Hindi -
// grievance in progress / resolved (officer actions) and the itemised deficiency notice.
import { call, login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';
const P = state.P.LG1;
const t = await login(P.email);
const ino = await login('ino.ranchi.p11@example.org');
const mark = psql(`SELECT now();`);
let r = await call('PATCH', '/applicants/me', { preferred_language: 'hi' }, t, { raw: true });
console.log(`PATCH preferred_language=hi: HTTP ${r.status} changed=${JSON.stringify(r.body.changed_fields)}`);
const g = psql(`SELECT id FROM grievances WHERE application_id='${P.applicationId}' AND status='OPEN' ORDER BY created_at LIMIT 1;`);
r = await call('POST', `/grievances/${g}/start`, {}, ino, { raw: true });
console.log(`INO starts grievance: HTTP ${r.status}`);
r = await call('POST', `/grievances/${g}/resolve`, { status: 'RESOLVED', note: 'Your application is with the institute officer for verification.' }, ino, { raw: true });
console.log(`INO resolves grievance: HTTP ${r.status} ${r.body.code ?? ''} ${r.body.code ? JSON.stringify(r.body.details) : ''}`);
r = await call('POST', `/applications/${P.applicationId}/deficiencies`, { reason: 'The uploaded income certificate scan cannot be read.' }, ino, { raw: true });
console.log(`INO issues itemised deficiency: HTTP ${r.status} ${r.body.code ?? ''} stage=${r.body.current_stage ?? ''} items=${r.body.items?.length ?? '-'}`);
await new Promise((res) => setTimeout(res, 5000));
console.log(psql(`SELECT template_key||' | locale='||locale||' requested='||coalesce(requested_locale,'-')||' | '||subject FROM notifications WHERE application_id='${P.applicationId}' AND recipient_account_id=(SELECT id FROM accounts WHERE email='${P.email}') AND created_at > '${mark}' AND channel='IN_APP' ORDER BY created_at;`));
console.log('\nall LG1 IN_APP notifications by template and language:\n' + psql(`SELECT template_key||': '||string_agg(locale||'(asked '||coalesce(requested_locale,'-')||')', ', ' ORDER BY created_at) FROM notifications WHERE application_id='${P.applicationId}' AND recipient_account_id=(SELECT id FROM accounts WHERE email='${P.email}') AND channel='IN_APP' GROUP BY template_key ORDER BY 1;`));
