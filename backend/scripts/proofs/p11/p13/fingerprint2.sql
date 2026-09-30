BEGIN READ ONLY;
SELECT 'audit_logs rows=' || count(*) || ' md5=' || md5(string_agg(a::text, '|' ORDER BY a.id)) FROM audit_logs a;
SELECT 'authorization_denials rows=' || count(*) || ' md5=' || md5(string_agg(d::text, '|' ORDER BY d.id)) FROM authorization_denials d;
SELECT 'heads: audit ' || (SELECT last_seq FROM audit_chain_head) || ', denials ' || (SELECT last_seq FROM authorization_denial_chain_head);
SELECT 'databases=' || string_agg(datname, ',' ORDER BY datname) FROM pg_database WHERE NOT datistemplate;
COMMIT;
