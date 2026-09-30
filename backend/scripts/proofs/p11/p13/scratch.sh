#!/usr/bin/env bash
# Phase 13A B4 - scratch-database proofs. NEVER touches the live database:
# every write below names vidyasetu_scratch explicitly.
set -u
cd "$(dirname "$0")/../../vidyasetu"
PG() { docker compose exec -T postgres sh -c "$1"; }
SQL() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d vidyasetu_scratch -v ON_ERROR_STOP=1 -At' ; }

dump() {
  echo "\$ pg_dump -Fc live -> /tmp/vidyasetu-live.dump (read-only on live)"
  PG 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/vidyasetu-live.dump && ls -l /tmp/vidyasetu-live.dump | cut -c1-80'
}
restore() {
  echo "\$ dropdb vidyasetu_scratch; createdb vidyasetu_scratch; pg_restore -d vidyasetu_scratch /tmp/vidyasetu-live.dump"
  PG 'dropdb -U "$POSTGRES_USER" --if-exists vidyasetu_scratch && createdb -U "$POSTGRES_USER" vidyasetu_scratch && pg_restore -U "$POSTGRES_USER" -d vidyasetu_scratch /tmp/vidyasetu-live.dump && echo "   restored: $(psql -U "$POSTGRES_USER" -d vidyasetu_scratch -At -c "SELECT count(*) FROM audit_logs") audit rows"'
}
verify() {
  echo "\$ verify-audit-chain.ts against vidyasetu_scratch"
  docker compose run --rm -T --entrypoint sh db-migrate -c \
    'DATABASE_URL=$(echo "$DATABASE_URL" | sed -E "s#/[^/?]+\?schema#/vidyasetu_scratch?schema#") npx tsx scripts/verify-audit-chain.ts > /tmp/report.json; code=$?; echo "   exit code $code"; node -e "const r=require(\"/tmp/report.json\"); console.log(\"   first_break: \" + JSON.stringify(r.first_break) + \"  legacy.matches_checkpoint: \" + r.legacy.matches_checkpoint)"; exit 0' 2>&1 | grep -v Container
}
tamper() { # $1 = label, stdin = SQL run as the owner with the guards disabled in scratch only
  echo "--- tamper: $1"
  { echo 'ALTER TABLE audit_logs DISABLE TRIGGER trigger_prevent_audit_log_mutation;'; cat; echo 'ALTER TABLE audit_logs ENABLE TRIGGER trigger_prevent_audit_log_mutation;'; } | tee /dev/stderr | SQL
}

case "${1:-}" in
  dump) dump ;;
  restore) restore ;;
  verify) verify ;;
  tamper) shift; tamper "$1" ;;
  *) echo "usage: $0 dump|restore|verify|tamper <label>" ;;
esac
