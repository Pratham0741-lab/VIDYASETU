BEGIN READ ONLY;
SELECT 'audit_logs rows=' || count(*) || ' md5=' || md5(string_agg(a::text, '|' ORDER BY a.id)) FROM audit_logs a;
SELECT 'audit_chain_head=' || last_seq || ':' || last_hash FROM audit_chain_head;
SELECT 'untagged applications=' || count(*) FROM applications a WHERE NOT EXISTS (SELECT 1 FROM test_fixtures f WHERE f.entity_type='application' AND f.entity_id=a.id);
SELECT 'all tables total rows=' || sum(n_live_tup) FROM pg_stat_user_tables;
SELECT 'databases=' || string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE NOT datistemplate;
COMMIT;
