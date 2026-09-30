DO $$
DECLARE t record; n bigint; total bigint; probe text;
  probes text[] := ARRAY['SBIN0009991:40091001','SBIN0009991:40091002','SBIN0009991:40091003','SBIN0009991:40091004','UBIN0531234:77019912','CNRB0004455:66012345',
                         '40091004','77019912','66012345', encode(convert_to('77019912','UTF8'),'hex')];
BEGIN
  FOREACH probe IN ARRAY probes LOOP
    total := 0;
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE format('SELECT count(*) FROM %I x WHERE row_to_json(x)::text LIKE %L', t.tablename, '%' || probe || '%') INTO n;
      IF n > 0 THEN RAISE NOTICE '    % row(s) in % contain %', n, t.tablename, probe; END IF;
      total := total + n;
    END LOOP;
    RAISE NOTICE 'probe % : % rows across % tables (incl. disbursements, sanction_orders, audit_logs)', rpad(probe, 22), total, (SELECT count(*) FROM pg_tables WHERE schemaname='public');
  END LOOP;
END $$;
SELECT 'applicants.bank_account (encrypted marker): ' || a.first_name || ' -> bytea ' || length(a.bank_account) || ' bytes, prefix ' || encode(substring(a.bank_account from 1 for 8), 'hex') FROM applicants a ORDER BY a.first_name;
SELECT 'disbursements columns: ' || string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'disbursements';
