-- ROLLBACK of the registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway 171b12daf285dfabe7469f1340cf198e12bc7011 served, from what 9e141b3d625cfd984dd2d60bcd4828ab62cc7a7e served.
-- 6 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   restores docs_write: input_schema_json
--   restores gmail_get_attachment: description
--   restores gmail_read: description
--   restores gmail_search: description
--   restores gws_run: input_schema_json
--   restores sheets_find_rows: input_schema_json
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
  -- docs_write
  UPDATE tools t SET description = 'Insert text at the beginning of a Google Doc. To append or edit at a specific position, use docs_get (mode ''index'') then docs_batch_update.', input_schema_json = '{"type":"object","properties":{"document_id":{"type":"string","description":"The Google Docs document ID"},"text":{"type":"string","description":"Text content to write to the document"}},"required":["document_id","text"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'docs_write'
    AND md5(t.description) = '7bb627c515352e22d7b946f5eca1d4e2'
    AND md5(t.input_schema_json::text) = 'ae4570da7d4f7a57fbad44548bfba5ad'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback docs_write: expected 1 row, updated %', n; END IF;

  -- gmail_get_attachment
  UPDATE tools t SET description = 'Describes one attachment of a Gmail message and, when the attachment is text, returns that text. Takes the message ID and the attachment''s part ID, both of which gmail_read lists for each attachment. Every response carries the file name, MIME type, size in bytes and a current attachment ID. For a text attachment (plain text, CSV, JSON, XML, HTML, calendar files and similar) of up to 0.5 MB, the response also carries the content as text, cut at 200,000 characters with a marker saying how much was left out, and with characters that cannot be seen removed. For any other type, or a larger file, no content is returned: the response states the size and the reason, and the attachment ID it carries is the one gmail_save_attachment_to_drive takes to put the file in Drive, where drive_read_file reads Word, Excel and PowerPoint files. File bytes are not returned as base64 for any type.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message the attachment is on."},"part_id":{"type":"string","description":"The attachment''s part ID from gmail_read, such as \"1\" or \"0.1\". It is the attachment''s place in the message and is the same on every read, where an attachment ID is issued new each time."}},"required":["message_id","part_id"]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_get_attachment'
    AND md5(t.description) = '2d337a07afc781fb14ce00a7b420c0e4'
    AND md5(t.input_schema_json::text) = '14a75cb88f7328502678fd9f7f1ac6eb'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_get_attachment: expected 1 row, updated %', n; END IF;

  -- gmail_read
  UPDATE tools t SET description = 'Read a specific email message by its ID. By default returns the full message including headers, body, and metadata. Use text_only for a compact view (flattened headers, decoded text body, attachment metadata) that avoids large MIME/base64 payloads.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The Gmail message ID to read"},"text_only":{"type":"boolean","description":"Return a compact view instead of the raw MIME payload: flattened from/to/cc/subject/date headers, the decoded text/plain body (falls back to tag-stripped text/html), and attachment metadata (partId, filename, mimeType, attachmentId). Recommended for triage: it avoids base64 attachment data overflowing the response."},"max_body_chars":{"type":"number","description":"Truncate the returned body text to this many characters (adds a truncation marker). Implies text_only."}},"required":["message_id"]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_read'
    AND md5(t.description) = '681fc7372f04dcaf11bbb976627bdf3a'
    AND md5(t.input_schema_json::text) = '920747e5db5a386d959de630dde534e5'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_read: expected 1 row, updated %', n; END IF;

  -- gmail_search
  UPDATE tools t SET description = 'Search Gmail messages using Gmail search syntax. Returns matching messages with flattened from/to/subject/date fields plus snippet and labels. Supports queries like "from:client@acme.com", "subject:proposal", "after:2024/01/01", "has:attachment", "label:important".', input_schema_json = '{"type":"object","properties":{"query":{"type":"string","description":"Gmail search query (e.g., \"from:john@example.com subject:Q4 proposal\", \"is:unread after:2024/06/01\")"},"max_results":{"type":"number","description":"Maximum number of messages to return (default: 10)"}},"required":["query"]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_search'
    AND md5(t.description) = '19dcc8211cf91488c1db98f549fd4cfe'
    AND md5(t.input_schema_json::text) = '9472dc2a1664a3ebff1ab03ab31cac3b'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_search: expected 1 row, updated %', n; END IF;

  -- gws_run
  UPDATE tools t SET description = 'A custom query tool for the Google Workspace REST APIs: sends one request to one API method and returns the API''s own JSON response. It reaches the methods of eight APIs, named here as Google''s reference names them: Gmail (gmail), Calendar (calendar), Drive (drive), Sheets (sheets), Docs (docs), Slides (slides), People (people) and Tasks (tasks). A call is a service, a resource path and a method, as listed under each API''s REST reference at https://developers.google.com/workspace, plus the method''s query parameters and, for a method that takes one, a JSON request body. It reaches methods that have no dedicated gmail_, calendar_, drive_, sheets_, docs_, slides_, contacts_ or tasks_ tool, with the access the connected account granted. A service, resource or method outside those eight APIs is refused before any request is sent. A response over 900 KB is cut at that size.', input_schema_json = '{"type":"object","properties":{"service":{"type":"string","description":"The API to call: one of gmail, calendar, drive, sheets, docs, slides, people, tasks."},"resource":{"type":"string","description":"The API resource, as a dotted path matching the API''s REST structure. Gmail''s resources sit under users (users.messages, users.drafts, users.labels, users.messages.attachments); Sheets has spreadsheets, spreadsheets.values and spreadsheets.sheets; top-level examples are events and calendarList (calendar) and files (drive)."},"method":{"type":"string","description":"API method (e.g., list, get, create, update, delete)"},"params":{"type":"object","description":"Query parameters as key-value pairs (e.g., { pageSize: 10, q: \"search query\" })"},"json_body":{"type":"object","description":"Request body for create/update operations (alias: body)"},"body":{"type":"object","description":"Request body for create/update operations (alias for json_body)"},"page_all":{"type":"boolean","description":"Fetch all pages of results (default: false, max 10 pages)"},"dry_run":{"type":"boolean","description":"Preview the request without executing it"}},"required":["service","resource","method"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gws_run'
    AND md5(t.description) = '053451effbd8e3e31a8c71baad93c971'
    AND md5(t.input_schema_json::text) = '39fd16be461b760648d9079c40a53b5f'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gws_run: expected 1 row, updated %', n; END IF;

  -- sheets_find_rows
  UPDATE tools t SET description = 'Find the rows in a spreadsheet range whose value in one column matches what you are looking for, and get back their ROW NUMBERS. Use this instead of reading a whole sheet and filtering the values yourself: on any real sheet that burns context on rows nobody asked for. Searches MANY values in a single call, so looking up twenty customers is one call and not twenty. Each match comes back with its 1-based sheet row number and a ready-made A1 range for that row, which is what lets a find be followed directly by a sheets_update. Values that matched nothing are listed separately, so an empty result cannot be mistaken for a broken call.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"range":{"type":"string","description":"The range to search: a tab name on its own searches that whole tab (the simplest correct call), or A1 notation naming a real tab, e.g. \"TabName!A:D\" for whole columns or \"TabName!A1:D500\" for a block — TabName stands for a tab the spreadsheet actually has. Row numbers in the result are absolute sheet rows, so a range starting at A10 reports its first data row as 11."},"column":{"type":"string","description":"Which column to match on: a header name taken from the first row of the range (\"Email\"), or an A1 column letter (\"B\")."},"values":{"type":"array","items":{"type":"string"},"description":"The values to look for. Pass every value you need in ONE call, e.g. [\"ana@example.com\", \"bo@example.com\"]."},"match":{"type":"string","enum":["exact","contains","prefix"],"description":"\"exact\" (default) compares the whole cell, case-sensitively, after trimming both sides. \"contains\" and \"prefix\" are substring tests and are case-INsensitive. Exact is the default because a lookup that quietly folded case would make two different rows interchangeable without ever saying so."},"has_header_row":{"type":"boolean","description":"Default true: the first row of the range is headers, is used to resolve a column name, and is never returned as a match. Set false when the range is pure data."},"max_results":{"type":"number","description":"Maximum matching rows returned per searched value. Default 50. A capped result says truncated: true, because a silent truncation reads exactly like a complete answer."}},"required":["spreadsheet_id","range","column","values"]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_find_rows'
    AND md5(t.description) = 'd4b6ed9b45534bf41206558fbef467f4'
    AND md5(t.input_schema_json::text) = '64d43676b89e0a757dac54c35c8fcb7d'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback sheets_find_rows: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('docs_write', 'gmail_get_attachment', 'gmail_read', 'gmail_search', 'gws_run', 'sheets_find_rows');
COMMIT;
