SELECT s.code, v.version_no, v.status, v.effective_from, v.effective_to,
  (SELECT count(*) FROM jsonb_array_elements(v.config->'rules') r WHERE r->>'type'='operational') AS operational
FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id ORDER BY s.code, v.version_no;
SELECT s.code||' v'||v.version_no AS version, r->>'id' AS id, r->>'expr' AS expr, jsonb_pretty(r->'params') AS params
FROM scheme_versions v JOIN schemes s ON s.id=v.scheme_id, jsonb_array_elements(v.config->'rules') r
WHERE v.status='active' AND r->>'type'='operational' ORDER BY 1, 2;
