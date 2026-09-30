DO $$
DECLARE t record; n bigint; total bigint; probe text;
BEGIN
  FOREACH probe IN ARRAY ARRAY['JH-ST-2026-R7731', encode(convert_to('JH-ST-2026-R7731','UTF8'),'hex'),
                               'JH-ST-2026-M7731', encode(convert_to('JH-ST-2026-M7731','UTF8'),'hex'),
                               '180000', encode(convert_to('180000','UTF8'),'hex'),
                               'Rs 180000', 'Scheduled Tribe (ST)'] LOOP
    total := 0;
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
      EXECUTE format('SELECT count(*) FROM %I x WHERE row_to_json(x)::text LIKE %L', t.tablename, '%' || probe || '%') INTO n;
      IF n > 0 THEN RAISE NOTICE '    % rows in % contain %', n, t.tablename, probe; END IF;
      total := total + n;
    END LOOP;
    RAISE NOTICE 'probe % : % matching rows across all % tables', rpad(probe, 34), total, (SELECT count(*) FROM pg_tables WHERE schemaname='public');
  END LOOP;
END $$;
SELECT extraction_engine, count(*) AS extractions,
       count(*) FILTER (WHERE extracted_data::text LIKE '%"redacted": true%') AS with_redaction_marker,
       count(*) FILTER (WHERE sensitive_values IS NOT NULL) AS with_encrypted_values,
       count(*) FILTER (WHERE raw_text_encrypted IS NOT NULL) AS raw_text_encrypted
FROM document_extractions GROUP BY 1;
SELECT e.extraction_engine, left(e.document_slot,30) slot, k AS sensitive_key, e.extracted_data->k AS as_stored, length(e.sensitive_values) enc_bytes
FROM document_extractions e, jsonb_object_keys(e.extracted_data) k
WHERE k IN ('family_income_annual','income','caste_cert_number','bank_account') ORDER BY 1,2;
SELECT 'audit copies of document_extractions: ' || count(*) || ', with redaction marker: ' || count(*) FILTER (WHERE row_data::text LIKE '%"redacted": true%') FROM audit_logs WHERE table_name='document_extractions';
