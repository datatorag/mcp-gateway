-- ROLLBACK of the registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway 7e23fde4ce44b31aff74aef0742c75116ddc00ca served, from what b251021c461e8a085b0075ef7a49e3f322de85cf served.
-- 2 row(s) change, 9 added, 0 removed.
-- Rows for gws-mcp: 68 before, 77 after.
--   restores calendar_list_events: input_schema_json
--   restores gws_run: description, input_schema_json
--   deletes drive_get_file
--   deletes drive_move_file
--   deletes drive_trash_file
--   deletes gmail_get_attachment
--   deletes gmail_list_drafts
--   deletes gmail_trash
--   deletes gmail_untrash
--   deletes sheets_copy_tab_to
--   deletes sheets_get_metadata
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
  -- calendar_list_events
  UPDATE tools t SET description = 'List upcoming events from a Google Calendar. By default returns a compact view per event: id, title, start/end, location, plain-text description (HTML stripped, truncated), organizer email, attendee count plus your own response status, the full attendee roster when the meeting has 10 or fewer people, a recurring flag, attachments, and the video join link (Meet or conference-data providers like Zoom). Only large-meeting rosters, reminders, and raw HTML are dropped — use full for the raw Calendar API payload, or calendar_get_event for one event''s complete detail.', input_schema_json = '{"type":"object","properties":{"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\" for the user''s main calendar)"},"time_min":{"type":"string","description":"Start of time range (ISO 8601, e.g., \"2024-06-01T00:00:00Z\"). Defaults to now."},"time_max":{"type":"string","description":"End of time range (ISO 8601, e.g., \"2024-06-30T23:59:59Z\"). Defaults to 7 days from now."},"max_results":{"type":"number","description":"Maximum number of events to return (default: 20)"},"query":{"type":"string","description":"Free-text search query to filter events"},"full":{"type":"boolean","description":"Return the raw Calendar API response instead of the compact view: full attendee rosters, reminders, conferenceData, htmlLink, and original (often HTML) descriptions. On busy calendars this can be very large — prefer the default compact view for triage and agenda use."},"max_description_chars":{"type":"number","description":"In the compact view, truncate each event''s plain-text description to this many characters (default: 500; adds a truncation marker). Set to 0 to omit descriptions entirely. Ignored when full is true."}},"required":[]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_list_events'
    AND md5(t.description) = 'a6c0598cf0d288f4eb89c5a07d06859d'
    AND md5(t.input_schema_json::text) = '492bac3cbc33744fafa1ea98f2cdad8d'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback calendar_list_events: expected 1 row, updated %', n; END IF;

  -- gws_run
  UPDATE tools t SET description = 'FALLBACK ONLY — use dedicated tools first (gmail_*, calendar_*, drive_*, sheets_*, docs_*, slides_*, contacts_*). Only use gws_run when no dedicated tool exists for the operation, e.g. Chat, Admin, Tasks, or advanced API calls not covered by other tools. Commands follow the pattern: gws <service> <resource> <method>.', input_schema_json = '{"type":"object","properties":{"service":{"type":"string","description":"Google Workspace service (e.g., calendar, chat, admin, classroom, contacts, drive, gmail, sheets, docs, slides)"},"resource":{"type":"string","description":"API resource. Nested resources use dotted paths matching the API''s REST structure — Gmail resources live under users (users.messages, users.drafts, users.labels, users.messages.attachments), not bare names like ''drafts''. Top-level examples: events (calendar), files (drive), spaces (chat)."},"method":{"type":"string","description":"API method (e.g., list, get, create, update, delete)"},"params":{"type":"object","description":"Query parameters as key-value pairs (e.g., { pageSize: 10, q: \"search query\" })"},"json_body":{"type":"object","description":"Request body for create/update operations (alias: body)"},"body":{"type":"object","description":"Request body for create/update operations (alias for json_body)"},"page_all":{"type":"boolean","description":"Fetch all pages of results (default: false, max 10 pages)"},"dry_run":{"type":"boolean","description":"Preview the request without executing it"}},"required":["service","resource","method"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gws_run'
    AND md5(t.description) = '053451effbd8e3e31a8c71baad93c971'
    AND md5(t.input_schema_json::text) = '2a5aa835204064e19e0c1366a2554012'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gws_run: expected 1 row, updated %', n; END IF;

  -- drive_get_file: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_get_file'
    AND md5(t.description) = '41f390966bb73a1ceae2a54de23c56c5'
    AND md5(t.input_schema_json::text) = 'c2ec4ca2729436853028f77432ad35cf';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_get_file: expected 1 row, deleted %', n; END IF;

  -- drive_move_file: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_move_file'
    AND md5(t.description) = '7858bc27cd0d6fe31759f519d4f3d2db'
    AND md5(t.input_schema_json::text) = 'dddc17d5e8f1739e44412b3221c569c2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_move_file: expected 1 row, deleted %', n; END IF;

  -- drive_trash_file: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_trash_file'
    AND md5(t.description) = 'a9ca497623c0b6d9366b6e3339cd2b67'
    AND md5(t.input_schema_json::text) = '8ad2f9a41b86108d8a8b91796efa2306';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_trash_file: expected 1 row, deleted %', n; END IF;

  -- gmail_get_attachment: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_get_attachment'
    AND md5(t.description) = 'da56bb72c3acb08cec4f244edfd49e46'
    AND md5(t.input_schema_json::text) = '14a75cb88f7328502678fd9f7f1ac6eb';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_get_attachment: expected 1 row, deleted %', n; END IF;

  -- gmail_list_drafts: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_list_drafts'
    AND md5(t.description) = 'f88ae3dfe371ab2fe5c11114bdeb8269'
    AND md5(t.input_schema_json::text) = '743dcb50c658636da46fdd91a9c5bcf7';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_list_drafts: expected 1 row, deleted %', n; END IF;

  -- gmail_trash: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_trash'
    AND md5(t.description) = '2c3c6f817d9da4b1fef95ce814339e67'
    AND md5(t.input_schema_json::text) = '31b2dd158bd82c7fdcb0787974c646bb';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_trash: expected 1 row, deleted %', n; END IF;

  -- gmail_untrash: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_untrash'
    AND md5(t.description) = '38f41a9eb4081bd6107b542504ab152c'
    AND md5(t.input_schema_json::text) = 'fc9255105961b41f984c7f6973e7c75c';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_untrash: expected 1 row, deleted %', n; END IF;

  -- sheets_copy_tab_to: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_copy_tab_to'
    AND md5(t.description) = '95989edbf2d3ced25e22d8c0b16f8e5b'
    AND md5(t.input_schema_json::text) = '146c8c4f93089b7875062e296c5376eb';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback sheets_copy_tab_to: expected 1 row, deleted %', n; END IF;

  -- sheets_get_metadata: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_get_metadata'
    AND md5(t.description) = '0a631ac97465342b8e1d8ebaee950278'
    AND md5(t.input_schema_json::text) = 'a87f737676265fd2c5c832c3f2e26895';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback sheets_get_metadata: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 68 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 68, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('calendar_list_events', 'drive_get_file', 'drive_move_file', 'drive_trash_file', 'gmail_get_attachment', 'gmail_list_drafts', 'gmail_trash', 'gmail_untrash', 'gws_run', 'sheets_copy_tab_to', 'sheets_get_metadata');
COMMIT;
