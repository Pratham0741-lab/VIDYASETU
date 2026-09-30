\echo '--- table, RLS flags, owner'
SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced, pg_get_userbyid(c.relowner) AS owner
FROM pg_class c WHERE c.relname = 'authorization_denials';
\echo '--- functions (SECURITY DEFINER, config, owner, EXECUTE grants)'
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig, pg_get_userbyid(p.proowner) AS owner,
       has_function_privilege('app_user', p.oid, 'EXECUTE') AS app_user_execute,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
FROM pg_proc p WHERE p.proname IN ('record_authorization_denial','authorization_denial_canonical','prevent_authorization_denial_mutation') ORDER BY 1;
\echo '--- policies'
SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr FROM pg_policy WHERE polrelid = 'authorization_denials'::regclass;
\echo '--- triggers'
SELECT tgname, tgenabled, pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE tgrelid = 'authorization_denials'::regclass AND NOT tgisinternal ORDER BY 1;
\echo '--- app_user table privileges'
SELECT p AS privilege, has_table_privilege('app_user', 'authorization_denials', p) AS granted
FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p;
\echo '--- untouched: audit trigger + SD guards still as before (definition hashes)'
SELECT proname, md5(pg_get_functiondef(oid)) FROM pg_proc WHERE proname IN ('process_audit_log_hash_chain','prevent_audit_log_mutation','workflow_system_transition','document_system_flag_application') ORDER BY 1;
