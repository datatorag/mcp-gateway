-- ROLLBACK of the registry change for notion-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway 0d278d4d621d8edb8c402210952c4224691e0d36 served, from what 61c85b08d507b81c3134dbea4b8ae56c91690659 served.
-- 0 row(s) change, 2 added, 0 removed.
-- Rows for notion-mcp: 18 before, 20 after.
--   deletes notion_attach_file
--   deletes notion_list_meeting_notes
-- A re-inserted row is a NEW row: its id, enabled flag and counters are the table's defaults,
-- not what the deleted row had.
-- Each statement is guarded by the md5 of the row's description and of input_schema_json::text
-- as the other commit's plugin served them. If the live row differs, the statement touches
-- nothing, the block raises and the transaction rolls back.
-- One transaction. Run by a person, on a confirmation that names the database. See the
-- SCRUM-390 spec for the order against the deploy.

BEGIN;
SET LOCAL standard_conforming_strings = on;
DO $registry_change$
DECLARE n int;
BEGIN
  -- notion_attach_file: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_attach_file'
    AND md5(t.description) = '4642b22da3b44500c6ee85f5f02c95e1'
    AND md5(t.input_schema_json::text) = 'c98a836850a7f486d46785448eb66162';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_attach_file: expected 1 row, deleted %', n; END IF;

  -- notion_list_meeting_notes: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_list_meeting_notes'
    AND md5(t.description) = 'd795615983ff9ba2ab81be32e392a984'
    AND md5(t.input_schema_json::text) = '19b7fd650c69051862cc447c1aec77dd';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_list_meeting_notes: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'notion-mcp';
  IF n <> 18 THEN RAISE EXCEPTION 'rows for notion-mcp: expected 18, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'notion-mcp' AND t.name IN ('notion_attach_file', 'notion_list_meeting_notes');
COMMIT;
