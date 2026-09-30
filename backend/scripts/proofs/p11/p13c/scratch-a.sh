#!/usr/bin/env bash
# Phase 13C A3 - denials tamper proofs on vidyasetu_scratch ONLY (a pg_restore of live).
set -u
cd "$(dirname "$0")/../../vidyasetu"
P13=../.p11/p13
PG() { docker compose exec -T postgres sh -c "$1"; }
SCR() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d vidyasetu_scratch -v ON_ERROR_STOP=1 -At -q'; }
LIVEFP() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -q' < $P13/fingerprint2.sql; }
restore() {
  PG 'dropdb -U "$POSTGRES_USER" --if-exists vidyasetu_scratch && createdb -U "$POSTGRES_USER" vidyasetu_scratch && pg_restore -U "$POSTGRES_USER" -d vidyasetu_scratch /tmp/vidyasetu-live.dump'
  echo "SELECT '   scratch restored: ' || count(*) || ' denial rows' FROM authorization_denials;" | SCR
}
verify() {
  docker compose run --rm -T -v "D:/PROJECTS/SIH_FELLOWSHIP/.p11/p13c:/app/proof13c" --entrypoint sh db-migrate -c \
    "DATABASE_URL=\$(echo \"\$DATABASE_URL\" | sed -E 's#/[^/?]+\?schema#/vidyasetu_scratch?schema#') npx tsx proof13c/verify-as-app-user.ts $1" 2>&1 | grep -v Container
}
tamper() { # stdin: SQL; the denial guards are disabled in scratch only
  { echo 'ALTER TABLE authorization_denials DISABLE TRIGGER trigger_prevent_authorization_denial_mutation;'; cat; echo 'ALTER TABLE authorization_denials ENABLE TRIGGER trigger_prevent_authorization_denial_mutation;'; } | SCR
}
echo "=== live fingerprint BEFORE"; LIVEFP | tee /tmp/live-before-13c.txt
echo "=== pg_dump live (read-only on live)"; PG 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/vidyasetu-live.dump && echo "   dump $(stat -c %s /tmp/vidyasetu-live.dump) bytes"'
echo "=== 0. untouched scratch"; restore
verify table; verify verifier-function
echo "=== 1. EDIT: change the ip_address of seq 12"; restore
echo "UPDATE authorization_denials SET ip_address = '10.9.9.9' WHERE seq = 12;" | tamper; verify verifier-function
echo "=== 2. DELETE: remove seq 21"; restore
echo "DELETE FROM authorization_denials WHERE seq = 21;" | tamper; verify verifier-function
echo "=== 3. RELINK: point seq 25 at seq 23 and re-hash seq 25 consistently"; restore
tamper <<'SQL'
UPDATE authorization_denials d
   SET prev_hash = x.h23,
       hash_input = replace(d.hash_input, '"prev_hash":"' || d.prev_hash || '"', '"prev_hash":"' || x.h23 || '"'),
       record_hash = encode(digest(replace(d.hash_input, '"prev_hash":"' || d.prev_hash || '"', '"prev_hash":"' || x.h23 || '"'), 'sha256'), 'hex')
  FROM (SELECT record_hash AS h23 FROM authorization_denials WHERE seq = 23) x
 WHERE d.seq = 25;
SELECT '   relinked seq 25: prev_hash = hash of seq 23: ' || (prev_hash = (SELECT record_hash FROM authorization_denials WHERE seq = 23)) || ', own hash consistent: ' || (record_hash = encode(digest(hash_input, 'sha256'), 'hex')) FROM authorization_denials WHERE seq = 25;
SQL
verify verifier-function
echo "=== drop scratch"; PG 'dropdb -U "$POSTGRES_USER" vidyasetu_scratch && rm -f /tmp/vidyasetu-live.dump && echo "   dropped"'
echo "=== live fingerprint AFTER"; LIVEFP | tee /tmp/live-after-13c.txt
cmp -s /tmp/live-before-13c.txt /tmp/live-after-13c.txt && echo "LIVE UNCHANGED (fingerprints identical)" || echo "LIVE FINGERPRINT DIFFERS"
