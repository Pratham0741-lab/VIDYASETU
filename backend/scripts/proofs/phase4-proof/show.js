const fs=require('fs');const o=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const st=JSON.parse(fs.readFileSync('p6-state.json','utf8')).apps;
const key=Object.fromEntries(Object.entries(st).map(([k,a])=>[a.id,k]));
if(o.code){console.log(JSON.stringify(o));process.exit(0);}
console.log('basis:',o.basis,'| version v'+o.scheme_version.version_no,'| dry_run:',o.dry_run,'| run:',o.selection_run_id,'| status:',o.selection_status);
if(o.policy.pools)console.log('policy pools:',JSON.stringify(o.policy.pools.map(p=>({pool:p.pool,seats:p.seats,eligible:p.eligible_categories,reservations:p.reservations.map(r=>r.reservation+' '+r.minimum.percentage+'% '+r.minimum.rounding+' -> '+r.required_seats+' seat(s)')}))));
if(o.policy.merit)console.log('merit:',JSON.stringify(o.policy.merit));
if(o.policy.limitation)console.log('limitation:',o.policy.limitation);
console.log('counts:',JSON.stringify(o.counts));
console.log('\nSELECTED  key  rank  merit  vertical   under   female_res qualifies_for');
for(const s of o.selected) console.log('          '+key[s.application_id].padEnd(4),String(s.merit_rank).padEnd(5),String(s.merit_value).padEnd(6),s.vertical_category.padEnd(10),String(s.horizontal_reservation).padEnd(7),String(s.is_female_reserved).padEnd(10),s.qualifies_for.join(',')||'-');
if(o.not_selected.length){console.log('\nNOT SELECTED key rank merit pool       reason');
for(const s of o.not_selected) console.log('          '+key[s.application_id].padEnd(4),String(s.merit_rank).padEnd(4),String(s.merit_value).padEnd(5),s.vertical_category.padEnd(10),s.reason,s.detail??'');}
if(o.pools.length)console.log('\npools:',JSON.stringify(o.pools));
for(const r of o.reservations)console.log('reservation:',JSON.stringify(r));
