-- Registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway 991c40bc54fe5682ede611ac41e7fa3b109a2aff (what is running) and 171b12daf285dfabe7469f1340cf198e12bc7011.
-- 1 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   changes drive_copy_file: description, input_schema_json
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
  UPDATE tools t SET description = 'Copies a file in Google Drive and names the copy in the same call. The copy carries the original''s tabs, formatting and formulas, so a copied template matches its source. With convert set to true, an Excel, Word or PowerPoint file is copied as a Google Sheet, Doc or Slides file, which the sheets_, docs_ and slides_ tools open; the original is left as it was. Returns the copy''s id, name, MIME type, folders and link. Folders are not copyable: Drive refuses them with a 403 "This file cannot be copied by the user", a limit of the API rather than of permissions.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file ID to copy"},"name":{"type":"string","minLength":1,"description":"Name for the new copy"},"parent_id":{"type":"string","description":"Folder ID to place the copy in (optional, defaults to the original''s folder)"},"convert":{"type":"boolean","description":"When true, the copy of an Excel, Word or PowerPoint file is a Google Sheet, Doc or Slides file (.xlsx and .xls to Sheets, .docx and .doc to Docs, .pptx and .ppt to Slides). A file of any other type is refused and nothing is copied. Defaults to false, a copy of the same type."}},"required":["file_id","name"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_copy_file'
    AND md5(t.description) = '2e918b083c142fcbf6ba631381d919a2'
    AND md5(t.input_schema_json::text) = '5de75c4750e7771116805c1972e3b010'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_copy_file: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('drive_copy_file');
COMMIT;
