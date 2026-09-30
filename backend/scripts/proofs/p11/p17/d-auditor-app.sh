#!/bin/sh
# Phase 17 D: runs d-auditor-app.js in the api container; denial rows counted as the DB owner.
cd /d/PROJECTS/SIH_FELLOWSHIP/vidyasetu
q="SELECT count(*) FROM authorization_denials WHERE denial_reason='AUDITOR_READ_ONLY';"
echo "AUDITOR_READ_ONLY denials before: $(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<<"$q")"
MSYS_NO_PATHCONV=1 docker compose exec -T -w /app api node - < ../.p11/p17/d-auditor-app.js 2>&1 | grep -v '"level":"info"'
echo "AUDITOR_READ_ONLY denials after:  $(docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<<"$q")"
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<<"SELECT 'newest: '||action_attempted||' | '||coalesce(subject_type,'-')||' | '||denial_reason||' | actor_role='||actor_role||' actor_type='||actor_type||' | table='||(details->>'table') FROM authorization_denials WHERE denial_reason='AUDITOR_READ_ONLY' ORDER BY occurred_at DESC LIMIT 1;"
