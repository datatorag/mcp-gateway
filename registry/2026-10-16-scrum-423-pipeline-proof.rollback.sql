-- Registry change for atlassian-mcp. PROPOSAL: NOT RUN.
-- SCRUM-423 pipeline proof, rollback. Not a build diff: one probe row that no connector
-- serves, added by the forward file and removed by the rollback, so the registry ends
-- exactly as it started. Written by scripts/registry-diff.mjs from a tool list of the
-- 24 rows atlassian-mcp holds plus the probe.
-- 1 removed. Rows for atlassian-mcp: 25 before, 24 after.
-- Each statement is guarded; if the live rows differ, it touches nothing, the block
-- raises and the transaction rolls back.

BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $registry_change$
DECLARE n int;
BEGIN
  -- __registry_pipeline_proof: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = '__registry_pipeline_proof'
    AND md5(t.description) = 'b0f951d3624778798dcb33475c494f91'
    AND md5(t.input_schema_json::text) = '6cb44a56118e2966acccfb86f18d0570';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback __registry_pipeline_proof: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'atlassian-mcp';
  IF n <> 24 THEN RAISE EXCEPTION 'rows for atlassian-mcp: expected 24, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'atlassian-mcp' AND t.name IN ('__registry_pipeline_proof');
COMMIT;
