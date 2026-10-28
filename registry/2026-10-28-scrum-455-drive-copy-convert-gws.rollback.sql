-- ROLLBACK of the registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway 991c40bc54fe5682ede611ac41e7fa3b109a2aff served, from what 171b12daf285dfabe7469f1340cf198e12bc7011 served.
-- 1 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   restores drive_copy_file: description, input_schema_json
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
  -- drive_copy_file
  UPDATE tools t SET description = 'Copy a file in Google Drive, naming the copy in the same call. Use this to instantiate a template instead of rebuilding it: the copy carries the original''s tabs, formatting, and formulas, so it cannot drift from the template the way a hand-rebuild does. Folders cannot be copied: Drive rejects that with a 403 "This file cannot be copied by the user", which is a limitation of the API and not a permissions problem to retry.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file ID to copy"},"name":{"type":"string","minLength":1,"description":"Name for the new copy"},"parent_id":{"type":"string","description":"Folder ID to place the copy in (optional, defaults to the original''s folder)"}},"required":["file_id","name"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_copy_file'
    AND md5(t.description) = '28bc3945de11f7c8aa803e8bed5e59a9'
    AND md5(t.input_schema_json::text) = '5892e89af97543c54fe020ff820926d3'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_copy_file: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('drive_copy_file');
COMMIT;
