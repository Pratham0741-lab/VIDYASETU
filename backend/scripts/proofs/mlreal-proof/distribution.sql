CREATE TEMP VIEW slot_type(slot, expected) AS VALUES
  ('Family Income Certificate','INCOME_CERTIFICATE'), ('income_certificate','INCOME_CERTIFICATE'),
  ('ST certificate issued by competent authority of State/UT','CASTE_CERTIFICATE'), ('caste_certificate','CASTE_CERTIFICATE'),
  ('Last qualified marks [percentage/Equivalent percentage in case of CGPA/OGPA etc.]','MARKSHEET'), ('marksheet','MARKSHEET'),
  ('Disability certificate (if applicable)','DISABILITY_CERT'), ('bonafide_certificate','BONAFIDE');
CREATE TEMP VIEW real AS
  SELECT DISTINCT ON (d.file_sha256) d.file_sha256, e.document_slot, coalesce(st.expected, '(none: unmapped slot)') AS expected,
         e.classification_type, e.classification_confidence::float AS conf
  FROM document_extractions e JOIN documents d ON d.id = e.document_id LEFT JOIN slot_type st ON st.slot = e.document_slot
  WHERE e.extraction_engine = 'ML_SERVICE' AND e.status = 'COMPLETED' ORDER BY d.file_sha256, e.created_at;
SELECT 'real extractions (all runs): ' || (SELECT count(*) FROM document_extractions WHERE extraction_engine='ML_SERVICE' AND status='COMPLETED')
    || ', distinct images: ' || (SELECT count(*) FROM real)
    || ', identical result for every repeat of an image: ' || (SELECT bool_and(n = 1) FROM (SELECT d.file_sha256, count(DISTINCT (e.classification_type, e.classification_confidence)) n FROM document_extractions e JOIN documents d ON d.id=e.document_id WHERE e.extraction_engine='ML_SERVICE' GROUP BY 1) z) AS summary;
\echo '--- per TRUE canonical type (the type the document actually is), distinct images'
SELECT expected AS true_type, count(*) AS images, min(conf) AS min, max(conf) AS max, round(avg(conf)::numeric, 3) AS mean,
       string_agg(DISTINCT classification_type, ', ') AS classified_as,
       count(*) FILTER (WHERE conf >= 0.85) AS at_or_above_085
FROM real GROUP BY 1 ORDER BY 1;
\echo '--- per CLASSIFIED type (the classifier top prediction), distinct images'
SELECT classification_type AS classified_type, count(*) AS images, min(conf) AS min, max(conf) AS max, round(avg(conf)::numeric, 3) AS mean
FROM real GROUP BY 1 ORDER BY 1;
\echo '--- every distinct real image'
SELECT left(document_slot, 44) AS slot, expected, classification_type, conf FROM real ORDER BY conf DESC, slot;
\echo '--- overall (correctly-typed documents only, i.e. excluding unmapped generic scans)'
SELECT count(*) AS images, min(conf), max(conf), round(avg(conf)::numeric,3) AS mean FROM real WHERE expected NOT LIKE '(none%';
