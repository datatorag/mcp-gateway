-- Registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway ceb78e4a6bdb8f5d9ab90709ad0a760c009bc216 (what is running) and 250bd7fc78afb5d591810ec587db137c05633458.
-- 4 row(s) change, 1 added, 0 removed.
-- Rows for gws-mcp: 87 before, 88 after.
--   changes gmail_list: description
--   changes gmail_read: description
--   changes gmail_search: description
--   changes gws_run: description
--   adds gmail_read_thread
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
  -- gmail_list
  UPDATE tools t SET description = 'List recent emails from the inbox. Optionally filter by label. Returns message IDs with flattened from/to/subject/date fields plus snippet and labels. Each result''s threadId opens its whole conversation in gmail_read_thread.', input_schema_json = '{"type":"object","properties":{"label":{"type":"string","description":"Label to filter by (e.g., \"INBOX\", \"SENT\", \"STARRED\", \"IMPORTANT\", or custom label). Defaults to INBOX."},"max_results":{"type":"number","description":"Maximum number of messages to return (default: 10)"}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_list'
    AND md5(t.description) = 'b360e2d46834a9f24ea1138d2941ffdc'
    AND md5(t.input_schema_json::text) = '3fdd6a7160b97422a2756142ebe47bfd'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_list: expected 1 row, updated %', n; END IF;

  -- gmail_read
  UPDATE tools t SET description = 'Read a specific email message by its ID. By default returns the full message including headers, body, and metadata. Use text_only for a compact view (flattened headers, decoded text body, attachment metadata) that avoids large MIME/base64 payloads. Each attachment is listed with its part ID; gmail_get_attachment takes the message ID and that part ID and returns the attachment''s text, or describes a file that is not text. The message''s threadId opens the whole conversation in gmail_read_thread.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The Gmail message ID to read"},"text_only":{"type":"boolean","description":"Return a compact view instead of the raw MIME payload: flattened from/to/cc/subject/date headers, the decoded text/plain body (falls back to tag-stripped text/html), and attachment metadata (partId, filename, mimeType, attachmentId). Recommended for triage: it avoids base64 attachment data overflowing the response."},"max_body_chars":{"type":"number","description":"Truncate the returned body text to this many characters (adds a truncation marker). Implies text_only."}},"required":["message_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_read'
    AND md5(t.description) = '681fc7372f04dcaf11bbb976627bdf3a'
    AND md5(t.input_schema_json::text) = '920747e5db5a386d959de630dde534e5'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_read: expected 1 row, updated %', n; END IF;

  -- gmail_search
  UPDATE tools t SET description = 'Search Gmail messages using Gmail search syntax. Returns matching messages with flattened from/to/subject/date fields plus snippet and labels. Supports queries like "from:client@acme.com", "subject:proposal", "after:2024/01/01", "has:attachment", "label:important". A message''s attachments are listed by gmail_read and read by gmail_get_attachment. Each result''s threadId opens its whole conversation in gmail_read_thread.', input_schema_json = '{"type":"object","properties":{"query":{"type":"string","description":"Gmail search query (e.g., \"from:john@example.com subject:Q4 proposal\", \"is:unread after:2024/06/01\")"},"max_results":{"type":"number","description":"Maximum number of messages to return (default: 10)"}},"required":["query"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_search'
    AND md5(t.description) = '19dcc8211cf91488c1db98f549fd4cfe'
    AND md5(t.input_schema_json::text) = '9472dc2a1664a3ebff1ab03ab31cac3b'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_search: expected 1 row, updated %', n; END IF;

  -- gws_run
  UPDATE tools t SET description = 'A custom query tool for the Google Workspace REST APIs: sends one request to one API method and returns the API''s own JSON response. It reaches the methods of eight APIs, named here as Google''s reference names them: Gmail (gmail), Calendar (calendar), Drive (drive), Sheets (sheets), Docs (docs), Slides (slides), People (people) and Tasks (tasks). A call is a service, a resource path and a method, as listed under each API''s REST reference at https://developers.google.com/workspace, plus the method''s query parameters and, for a method that takes one, a JSON request body. It reaches methods that have no dedicated gmail_, calendar_, drive_, sheets_, docs_, slides_, contacts_ or tasks_ tool, with the access the connected account granted. A Gmail thread (users.threads.get) has one: gmail_read_thread answers every message of a conversation, with headers, bodies and attachments. A service, resource or method outside those eight APIs is refused before any request is sent. A response over 900 KB is cut at that size.', input_schema_json = '{"type":"object","properties":{"service":{"type":"string","description":"The API to call: one of gmail, calendar, drive, sheets, docs, slides, people, tasks."},"resource":{"type":"string","description":"The API resource, as a dotted path matching the API''s REST structure. Gmail''s resources sit under users (users.messages, users.drafts, users.labels, users.messages.attachments); Sheets has spreadsheets, spreadsheets.values and spreadsheets.sheets; top-level examples are events and calendarList (calendar) and files (drive)."},"method":{"type":"string","description":"API method (e.g., list, get, create, update, delete)"},"params":{"type":"object","description":"Query parameters as key-value pairs (e.g., { pageSize: 10, q: \"search query\" })"},"json_body":{"type":"object","description":"Request body for create/update operations (alias: body)"},"body":{"type":"object","x-alias-of":"json_body","description":"Request body for create/update operations (alias for json_body)"},"page_all":{"type":"boolean","description":"Fetch all pages of results (default: false, max 10 pages)"},"dry_run":{"type":"boolean","description":"Preview the request without executing it"}},"required":["service","resource","method"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gws_run'
    AND md5(t.description) = '053451effbd8e3e31a8c71baad93c971'
    AND md5(t.input_schema_json::text) = '39fd16be461b760648d9079c40a53b5f'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gws_run: expected 1 row, updated %', n; END IF;

  -- gmail_read_thread: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'gmail_read_thread', 'gws-mcp__gmail_read_thread',
    'Reads a whole Gmail conversation by its thread ID, the threadId that gmail_search, gmail_list and gmail_read return. Answers every message of the thread in one call, in the order they were sent, oldest to newest, drafts and messages in Trash included and marked as such. With depth full, the default, each message carries its from, to, cc, subject and date, the decoded text body, and its attachments with the part IDs gmail_get_attachment takes. With depth headers, each message carries the same headers and Gmail''s snippet but no body, which keeps a long conversation small. The bodies of one answer are held to 200,000 characters together: when a thread is longer, the bodies of its oldest messages are left out, and left_out lists those message IDs, each readable in full by gmail_read.',
    '{"type":"object","properties":{"thread_id":{"type":"string","description":"The Gmail thread ID, as threadId in a gmail_search, gmail_list or gmail_read answer"},"depth":{"type":"string","enum":["full","headers"],"description":"full (the default): headers, decoded text body and attachments for each message. headers: headers and Gmail''s snippet only, no body or attachments."},"max_body_chars":{"type":"number","description":"Cuts each message''s body to this many characters, with a truncation marker, before the 200,000 character total is applied. Applies to depth full."}},"required":["thread_id"]}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_read_thread');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_read_thread: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 88 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 88, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('gmail_list', 'gmail_read', 'gmail_read_thread', 'gmail_search', 'gws_run');
COMMIT;
