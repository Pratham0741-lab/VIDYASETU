cd /d/PROJECTS/SIH_FELLOWSHIP/vidyasetu
APPPW=$(grep -E '^POSTGRES_APP_PASSWORD=' .env | cut -d= -f2-)
A=$(node -e "console.log(require('D:/PROJECTS/SIH_FELLOWSHIP/.phase7-proof/p7-state.json').A.applicationId)")
owner() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off "$@"' -- "$@"; }
appuser() { docker compose exec -T -e PGPASSWORD="$APPPW" postgres sh -c 'psql -h 127.0.0.1 -p 5432 -U app_user -d "$POSTGRES_DB" -P pager=off "$@"' -- "$@"; }
snap() { owner -Atc "SELECT 'app row md5='||md5(row_to_json(a)::text)||' needs_eligibility_review='||needs_eligibility_review||' consistency='||coalesce(document_consistency_status,'null')||' stage='||current_stage FROM applications a WHERE id='$A'" -c "SELECT 'audit_logs='||count(*)||' last_hash='||(SELECT record_hash FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 1) FROM audit_logs"; }
