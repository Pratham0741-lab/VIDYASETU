DO $$
DECLARE t record; n bigint; total bigint := 0; probe text;
BEGIN
  FOREACH probe IN ARRAY ARRAY['900000', encode(convert_to('900000','UTF8'),'hex'), 'JH-ST-2026-A7731', encode(convert_to('JH-ST-2026-A7731','UTF8'),'hex')] LOOP
    total := 0;
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
      EXECUTE format('SELECT count(*) FROM %I x WHERE row_to_json(x)::text LIKE %L', t.tablename, '%' || probe || '%') INTO n;
      IF n > 0 THEN RAISE NOTICE '  % rows in % contain %', n, t.tablename, probe; END IF;
      total := total + n;
    END LOOP;
    RAISE NOTICE 'probe % : % matching rows across all % tables', rpad(probe, 34), total, (SELECT count(*) FROM pg_tables WHERE schemaname='public');
  END LOOP;
END $$;
SELECT 'extractions with a redaction marker: ' || count(*) FROM document_extractions WHERE extracted_data::text LIKE '%"redacted": true%';
SELECT 'audit copies of extractions with a redaction marker: ' || count(*) FROM audit_logs WHERE table_name='document_extractions' AND row_data::text LIKE '%"redacted": true%';
SELECT document_slot, extracted_data->'family_income_annual' AS income_as_stored, length(sensitive_values) AS encrypted_bytes FROM document_extractions WHERE extracted_data ? 'family_income_annual' ORDER BY created_at;
