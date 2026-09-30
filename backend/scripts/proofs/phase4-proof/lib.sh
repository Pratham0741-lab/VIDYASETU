# Proof helpers (outside the repo). Passwords are random per run, kept in pw.env.
API=http://127.0.0.1:3000
[ -f pw.env ] || { echo "PW=$(node -e "console.log('Pf4-'+require('crypto').randomBytes(12).toString('base64url'))")" > pw.env; }
. ./pw.env
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);const f=new Function('o','return ('+process.argv[1]+')');const r=f(o);console.log(typeof r==='string'?r:JSON.stringify(r,null,1))})" "$1"; }
post() { curl -s -X POST "$API$1" -H 'Content-Type: application/json' ${TOKEN:+-H "Authorization: Bearer $TOKEN"} -d "$2"; }
get() { curl -s "$API$1" ${TOKEN:+-H "Authorization: Bearer $TOKEN"}; }
status() { curl -s -o /dev/null -w '%{http_code}' -X "$1" "$API$2" -H 'Content-Type: application/json' ${TOKEN:+-H "Authorization: Bearer $TOKEN"} ${3:+-d "$3"}; }
login() { post /api/v1/auth/login "{\"email\":\"$1\",\"password\":\"$PW\"}" | j o.access_token; }
psqlq() { (cd /d/PROJECTS/SIH_FELLOWSHIP/vidyasetu && docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off "$@"' -- "$@"); }
