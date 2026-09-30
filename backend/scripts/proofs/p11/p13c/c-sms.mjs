// Phase 13C proof 2 (channels): a Hindi applicant with a phone gets the notice in-app, by email and by mock SMS.
import { call, login, save, state } from '../lib.mjs';
import { psql } from '../psql.mjs';
import { defApplicant } from './c-setup.mjs';
const H2 = await defApplicant('H2', 'Salomi', 'Marandi', 'hi', { phone: '9876543013' });
const ino = await login('ino.ranchi.p11@example.org');
const r = await call('POST', `/applications/${H2.applicationId}/deficiencies`, { reason: 'Income certificate is older than the scheme allows.' }, ino, { raw: true });
H2.deficiencyId = r.body.deficiency_id; save();
console.log(`H2 ${H2.application_no} (hi, phone on record): issue HTTP ${r.status} stage=${r.body.current_stage} items=${r.body.items?.length}`);
await new Promise((res) => setTimeout(res, 5000));
console.log(psql(`SELECT channel||' locale='||locale||' requested='||requested_locale||' '||status||' to='||coalesce(right(recipient_address,4),'-')||' subject='||subject FROM notifications WHERE application_id='${H2.applicationId}' AND template_key='DEFICIENCY_NOTICE' ORDER BY channel;`));
