cd /d/PROJECTS/SIH_FELLOWSHIP/vidyasetu
APPPW=$(grep -E '^POSTGRES_APP_PASSWORD=' .env | cut -d= -f2-)
owner() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off "$@"' -- "$@"; }
# app_user over TCP (-h 127.0.0.1), password via env, never printed
appuser() { docker compose exec -T -e PGPASSWORD="$APPPW" postgres sh -c 'psql -h 127.0.0.1 -p 5432 -U app_user -d "$POSTGRES_DB" -P pager=off -v ON_ERROR_STOP=0 "$@"' -- "$@"; }
snap() { owner -Atc "SELECT 'app row md5='||md5(row_to_json(a)::text)||' stage='||current_stage||'/'||status||' due='||coalesce(stage_due_at::text,'null'), 'audit_logs='||(SELECT count(*) FROM audit_logs)||' last_hash='||(SELECT record_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1), 'workflow_transitions='||(SELECT count(*) FROM workflow_transitions) FROM applications a WHERE id='0e9f5f6c-a683-4311-ae51-e88bc61d6daa'"; }
