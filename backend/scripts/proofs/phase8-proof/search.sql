DO $$
DECLARE t record; n bigint; total bigint; probe text;
BEGIN
  FOREACH probe IN ARRAY ARRAY['300000', 'JH-ST-2026-Q8801', 'SBIN0001234:3008801Q'] LOOP
    total := 0;
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
      EXECUTE format('SELECT count(*) FROM %I x WHERE row_to_json(x)::text LIKE %L', t.tablename, '%' || probe || '%') INTO n;
      IF n > 0 THEN RAISE NOTICE '    % row(s) in % contain %', n, t.tablename, probe; END IF;
      total := total + n;
    END LOOP;
    RAISE NOTICE 'probe % : % matching rows across % tables (incl. notifications and audit_logs)', rpad(probe, 22), total, (SELECT count(*) FROM pg_tables WHERE schemaname='public');
  END LOOP;
END $$;
SELECT 'notifications rows for Q: ' || count(*) FROM notifications n JOIN accounts a ON a.id=n.recipient_account_id WHERE a.email='sunil.p8@example.org';
SELECT 'audit_logs copies of notifications: ' || count(*) FROM audit_logs WHERE table_name='notifications';
