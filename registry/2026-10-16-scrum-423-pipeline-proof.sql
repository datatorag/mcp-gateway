-- Registry change for atlassian-mcp. PROPOSAL: NOT RUN.
-- SCRUM-423 pipeline proof, forward. Not a build diff: one probe row that no connector
-- serves, added by the forward file and removed by the rollback, so the registry ends
-- exactly as it started. Written by scripts/registry-diff.mjs from a tool list of the
-- 24 rows atlassian-mcp holds plus the probe.
-- 1 added. Rows for atlassian-mcp: 24 before, 25 after.
-- Each statement is guarded; if the live rows differ, it touches nothing, the block
-- raises and the transaction rolls back.

BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $registry_change$
DECLARE n int;
BEGIN
  -- __registry_pipeline_proof: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, '__registry_pipeline_proof', 'atlassian-mcp____registry_pipeline_proof',
    'Registry pipeline check, not a tool. No connector serves it, and it is removed within minutes of being added.',
    '{"type":"object","properties":{}}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'atlassian-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'atlassian-mcp____registry_pipeline_proof');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward __registry_pipeline_proof: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'atlassian-mcp';
  IF n <> 25 THEN RAISE EXCEPTION 'rows for atlassian-mcp: expected 25, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'atlassian-mcp' AND t.name IN ('__registry_pipeline_proof');
COMMIT;
