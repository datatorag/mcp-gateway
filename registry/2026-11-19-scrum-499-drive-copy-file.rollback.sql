-- ROLLBACK of the registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway c297ee157d8ca5933f651740b21c8cba4937c99e served, from what 183946ea48523d5377a806b41e206df26e0ca2ca served.
-- 1 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 88 before, 88 after.
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
  UPDATE tools t SET description = 'Copies a file in Google Drive and names the copy in the same call. The copy carries the original''s tabs, formatting and formulas, so a copied template matches its source. With convert set to true, an Excel, Word or PowerPoint file is copied as a Google Sheet, Doc or Slides file, which the sheets_, docs_ and slides_ tools open; the original is left as it was. With target_mime_type, the copy is converted to the Google type named, which is how a PDF or an image becomes a Google Doc with its text recognised (ocr_language sets the language for that recognition); when convert and target_mime_type are both given, target_mime_type decides the type. Returns the copy''s id, name, MIME type, folders and link. Folders are not copyable: Drive refuses them with a 403 "This file cannot be copied by the user", a limit of the API rather than of permissions.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file ID to copy"},"name":{"type":"string","minLength":1,"description":"Name for the new copy"},"parent_id":{"type":"string","description":"Folder ID to place the copy in (optional, defaults to the original''s folder)"},"convert":{"type":"boolean","description":"When true, the copy of an Excel, Word or PowerPoint file is a Google Sheet, Doc or Slides file (.xlsx and .xls to Sheets, .docx and .doc to Docs, .pptx and .ppt to Slides). A file of any other type is refused and nothing is copied. Defaults to false, a copy of the same type. Ignored when target_mime_type is given."},"target_mime_type":{"type":"string","minLength":1,"description":"The Google type the copy is converted to, e.g. application/vnd.google-apps.document for a Google Doc (a PDF or image copied this way has its text recognised), application/vnd.google-apps.spreadsheet or application/vnd.google-apps.presentation. Sent to Drive as the copy''s mimeType, with no lookup of the source''s type; Drive refuses a conversion it does not support. Optional; takes precedence over convert."},"ocr_language":{"type":"string","minLength":1,"description":"Language hint for the text recognition when a PDF or image is converted to a Google Doc, as a BCP-47 code such as en, de or ja. Optional; Drive detects the language when it is absent."}},"required":["file_id","name"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_copy_file'
    AND md5(t.description) = 'e79259950aafb26b16a464fb30c3222b'
    AND md5(t.input_schema_json::text) = '75693948e5703f03cb25a23e15c14d91'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_copy_file: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 88 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 88, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('drive_copy_file');
COMMIT;
