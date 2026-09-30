DO $$
DECLARE t record; n bigint; total bigint; probe text;
BEGIN
  FOREACH probe IN ARRAY ARRAY['180000', '300000', '150000', '160000', '350000'] LOOP
    total := 0;
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
      EXECUTE format('SELECT count(*) FROM %I x WHERE row_to_json(x)::text LIKE %L', t.tablename, '%' || probe || '%') INTO n;
      IF n > 0 THEN RAISE NOTICE '    % row(s) in % contain %', n, t.tablename, probe; END IF;
      total := total + n;
    END LOOP;
    RAISE NOTICE 'registered income % : % rows across all tables and audit copies', probe, total;
  END LOOP;
END $$;
