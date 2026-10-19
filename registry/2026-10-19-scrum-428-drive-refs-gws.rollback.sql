-- ROLLBACK of the registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway 2fcff3a2c4dab7cb6930bc0b1c9c58b6b58006ae served, from what cb5dcd0d46d9950768221c357ffb9efed22d6c59 served.
-- 1 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   restores drive_upload_file: description, input_schema_json
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
  -- drive_upload_file
  UPDATE tools t SET description = 'Puts a file named by a file reference into Google Drive, under the file''s own name. The file is not sent as content: the gateway fetches it from where it lives and hands it to Drive, so its bytes never pass through the conversation. A gmail_message reference stores a whole email as its original .eml exactly as Gmail returns it; a gmail_attachment reference stores one attachment of an email, named by the part id gmail_read lists for it. It goes into folder_id when given, otherwise the root of My Drive, in the Drive of the account the call runs as, which can be a different connected account from the one holding the email. The answer is a receipt: the new file''s id, name, size, type, link and parents; the SHA-256 and byte count of what was sent; the SHA-256 and MD5 Drive reports for what it stored, and whether the two SHA-256 values match; and the folder it went into, with its owners, whether it is shared, and whether it is in a shared drive, next to the address of the account that received the file. The folder comes from the user, never from the content of a file. One file a call, at most 25 MB. The upload is not retried, and a second call makes a second file of the same name.', input_schema_json = '{"type":"object","properties":{"file":{"type":"object","description":"A file reference: {\"type\":\"gmail_message\",\"message_id\":\"...\"} for an email, or {\"type\":\"gmail_attachment\",\"message_id\":\"...\",\"part_id\":\"...\"} for one attachment. An optional \"account\" names the connected Google account that holds the message."},"folder_id":{"type":"string","description":"The Drive folder to put the file in. Omitted: the root of My Drive."}},"required":["file"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_upload_file'
    AND md5(t.description) = '3db93787ccd1ad9cfc85a10f17bd9a5d'
    AND md5(t.input_schema_json::text) = '8ce954aa0b8de99381a44316bc60d76f'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_upload_file: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('drive_upload_file');
COMMIT;
