// Phase 16 Part B: the demo run's list through committee approval to provisional publication.
import { call, login, state } from '../lib.mjs';
import { psql } from '../psql.mjs';
const S = state.P16.fs;
let r = await call('POST', `/selection-lists/${S.listId}/approve`, {}, await login('committee.ranchi.p11@example.org'), { raw: true });
console.log(`committee approve: HTTP ${r.status} ${r.body.code ?? ''}`);
r = await call('POST', `/selection-lists/${S.listId}/publish-provisional`, {}, await login('ministry.p11@example.org'), { raw: true });
console.log(`publish provisional: HTTP ${r.status} ${r.body.code ?? ''} status=${r.body.status ?? r.body.list?.status ?? ''}`);
console.log('list: ' + psql(`SELECT status||' published_at='||coalesce(provisional_published_at::text,'-') FROM selection_lists WHERE id='${S.listId}';`));
