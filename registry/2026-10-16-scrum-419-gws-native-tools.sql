-- Registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway 7e23fde4ce44b31aff74aef0742c75116ddc00ca (what is running) and b251021c461e8a085b0075ef7a49e3f322de85cf.
-- 2 row(s) change, 9 added, 0 removed.
-- Rows for gws-mcp: 68 before, 77 after.
--   changes calendar_list_events: input_schema_json
--   changes gws_run: description, input_schema_json
--   adds drive_get_file
--   adds drive_move_file
--   adds drive_trash_file
--   adds gmail_get_attachment
--   adds gmail_list_drafts
--   adds gmail_trash
--   adds gmail_untrash
--   adds sheets_copy_tab_to
--   adds sheets_get_metadata
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
  UPDATE tools t SET description = 'List upcoming events from a Google Calendar. By default returns a compact view per event: id, title, start/end, location, plain-text description (HTML stripped, truncated), organizer email, attendee count plus your own response status, the full attendee roster when the meeting has 10 or fewer people, a recurring flag, attachments, and the video join link (Meet or conference-data providers like Zoom). Only large-meeting rosters, reminders, and raw HTML are dropped — use full for the raw Calendar API payload, or calendar_get_event for one event''s complete detail.', input_schema_json = '{"type":"object","properties":{"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\" for the user''s main calendar)"},"time_min":{"type":"string","description":"Start of time range (ISO 8601, e.g., \"2024-06-01T00:00:00Z\"). Defaults to now."},"time_max":{"type":"string","description":"End of time range (ISO 8601, e.g., \"2024-06-30T23:59:59Z\"). Defaults to 7 days from now."},"max_results":{"type":"number","description":"Maximum number of events to return (default: 20)"},"query":{"type":"string","description":"Free-text search query to filter events"},"page_token":{"type":"string","description":"The nextPageToken from an earlier call with the same calendar, time range and query, to read the page of events after it."},"full":{"type":"boolean","description":"Return the raw Calendar API response instead of the compact view: full attendee rosters, reminders, conferenceData, htmlLink, and original (often HTML) descriptions. On busy calendars this can be very large — prefer the default compact view for triage and agenda use."},"max_description_chars":{"type":"number","description":"In the compact view, truncate each event''s plain-text description to this many characters (default: 500; adds a truncation marker). Set to 0 to omit descriptions entirely. Ignored when full is true."}},"required":[]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_list_events'
    AND md5(t.description) = 'a6c0598cf0d288f4eb89c5a07d06859d'
    AND md5(t.input_schema_json::text) = '527f599f8edea3fd899b4fb01463330d'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_list_events: expected 1 row, updated %', n; END IF;

  -- gws_run
  UPDATE tools t SET description = 'A custom query tool for the Google Workspace REST APIs: sends one request to one API method and returns the API''s own JSON response. It reaches the methods of eight APIs, named here as Google''s reference names them: Gmail (gmail), Calendar (calendar), Drive (drive), Sheets (sheets), Docs (docs), Slides (slides), People (people) and Tasks (tasks). A call is a service, a resource path and a method, as listed under each API''s REST reference at https://developers.google.com/workspace, plus the method''s query parameters and, for a method that takes one, a JSON request body. It reaches methods that have no dedicated gmail_, calendar_, drive_, sheets_, docs_, slides_, contacts_ or tasks_ tool, with the access the connected account granted. A service, resource or method outside those eight APIs is refused before any request is sent. A response over 900 KB is cut at that size.', input_schema_json = '{"type":"object","properties":{"service":{"type":"string","description":"The API to call: one of gmail, calendar, drive, sheets, docs, slides, people, tasks."},"resource":{"type":"string","description":"The API resource, as a dotted path matching the API''s REST structure. Gmail''s resources sit under users (users.messages, users.drafts, users.labels, users.messages.attachments); Sheets has spreadsheets, spreadsheets.values and spreadsheets.sheets; top-level examples are events and calendarList (calendar) and files (drive)."},"method":{"type":"string","description":"API method (e.g., list, get, create, update, delete)"},"params":{"type":"object","description":"Query parameters as key-value pairs (e.g., { pageSize: 10, q: \"search query\" })"},"json_body":{"type":"object","description":"Request body for create/update operations (alias: body)"},"body":{"type":"object","description":"Request body for create/update operations (alias for json_body)"},"page_all":{"type":"boolean","description":"Fetch all pages of results (default: false, max 10 pages)"},"dry_run":{"type":"boolean","description":"Preview the request without executing it"}},"required":["service","resource","method"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gws_run'
    AND md5(t.description) = '5f166363b5bcbfda6f6a3ee9946aed0a'
    AND md5(t.input_schema_json::text) = '6ee9ac220376316e78635786338049df'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gws_run: expected 1 row, updated %', n; END IF;

  -- drive_get_file: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'drive_get_file', 'gws-mcp__drive_get_file',
    'Describes one file or folder in Google Drive without reading its content. Takes the file ID. Returns its name, MIME type, size in bytes when Drive reports one (folders have none), the IDs of the folders it is in, its owners'' names and addresses, when it was created and last modified, its link, whether it is in Trash, whether it is shared, and the shared drive it belongs to when it is in one. A file the account cannot see answers as not found.',
    '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to describe"}},"required":["file_id"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__drive_get_file');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_get_file: expected 1 row, inserted %', n; END IF;

  -- drive_move_file: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'drive_move_file', 'gws-mcp__drive_move_file',
    'Moves a file or folder in Google Drive into another folder. Takes the file ID and the destination folder ID. The item is added to the destination folder and removed from the folder or folders it was in, so it ends up in one place; its name, content and ID are unchanged. Returns the item''s ID, name, the folder it is now in and its link. An item already in the destination folder is left where it is and reported as not moved.',
    '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to move"},"folder_id":{"type":"string","description":"The ID of the folder to move it into"}},"required":["file_id","folder_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__drive_move_file');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_move_file: expected 1 row, inserted %', n; END IF;

  -- drive_trash_file: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'drive_trash_file', 'gws-mcp__drive_trash_file',
    'Moves a file or folder in Google Drive to Trash. Takes the file ID. The item stays in Trash, where Drive deletes it for good after 30 days and where its owner can restore it before then; trashing a folder trashes what is inside it. Returns the item''s ID, name and its trashed state as Drive reports it afterwards. Works on any Drive item the account is allowed to trash, including Docs, Sheets and Slides.',
    '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to move to Trash"}},"required":["file_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__drive_trash_file');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_trash_file: expected 1 row, inserted %', n; END IF;

  -- gmail_get_attachment: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_get_attachment', 'gws-mcp__gmail_get_attachment',
    'Describes one attachment of a Gmail message and, when the attachment is text, returns that text. Takes the message ID and the attachment''s part ID, both of which gmail_read lists for each attachment. Every response carries the file name, MIME type, size in bytes and a current attachment ID. For a text attachment (plain text, CSV, JSON, XML, HTML, calendar files and similar) of up to 0.5 MB, the response also carries the content as text, cut at 200,000 characters with a marker saying how much was left out, and with characters that cannot be seen removed. For any other type, or a larger file, no content is returned: the response states the size and the reason, and the attachment ID it carries is the one gmail_save_attachment_to_drive takes to put the file in Drive, where drive_read_file reads Word, Excel and PowerPoint files. File bytes are not returned as base64 for any type.',
    '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message the attachment is on."},"part_id":{"type":"string","description":"The attachment''s part ID from gmail_read, such as \"1\" or \"0.1\". It is the attachment''s place in the message and is the same on every read, where an attachment ID is issued new each time."}},"required":["message_id","part_id"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_get_attachment');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_get_attachment: expected 1 row, inserted %', n; END IF;

  -- gmail_list_drafts: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_list_drafts', 'gws-mcp__gmail_list_drafts',
    'Lists the drafts in a Gmail mailbox. Returns one entry per draft with its draft ID, the ID of the message it holds and that message''s thread ID, plus a count and a page token when more drafts remain. The draft ID is what gmail_update_draft, gmail_send_draft and gmail_delete_draft take; the message ID is what gmail_read takes to show the draft''s content. A mailbox with no drafts answers with a count of 0 and an empty list.',
    '{"type":"object","properties":{"max_results":{"type":"number","description":"The most drafts to return in one page (default: 20, at most 500)."},"query":{"type":"string","description":"Narrows the list to drafts matching a Gmail search query, in the same syntax as gmail_search (for example \"subject:invoice\" or \"to:someone@example.com\")."},"page_token":{"type":"string","description":"The nextPageToken from an earlier call, to read the page after it."}},"required":[]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_list_drafts');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_list_drafts: expected 1 row, inserted %', n; END IF;

  -- gmail_trash: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_trash', 'gws-mcp__gmail_trash',
    'Moves one Gmail message to Trash. Takes the message ID. The message leaves the inbox and every other label view and stays in Trash, where Gmail deletes it for good after 30 days; gmail_untrash restores it before then. Returns the message ID and the labels the message carries afterwards. Acts on the one message named, not on the rest of its thread.',
    '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to move to Trash, as gmail_search, gmail_list and gmail_read return it."}},"required":["message_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_trash');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_trash: expected 1 row, inserted %', n; END IF;

  -- gmail_untrash: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_untrash', 'gws-mcp__gmail_untrash',
    'Takes one Gmail message out of Trash. Takes the message ID. Returns the message ID and the labels the message carries afterwards. A message Gmail has already deleted from Trash is gone and answers as not found.',
    '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to take out of Trash."}},"required":["message_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_untrash');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_untrash: expected 1 row, inserted %', n; END IF;

  -- sheets_copy_tab_to: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'sheets_copy_tab_to', 'gws-mcp__sheets_copy_tab_to',
    'Copies one tab of a Google Sheets spreadsheet into another spreadsheet. Takes the source spreadsheet ID, the title of the tab to copy and the destination spreadsheet ID. The copy carries the tab''s values, formulas and formatting and is added to the destination as a new tab, which Google names "Copy of <title>"; nothing already in the destination is changed, and the source is left as it was. Returns the new tab''s sheetId, title and position in the destination. The account needs edit access to the destination.',
    '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The ID of the spreadsheet that holds the tab to copy"},"title":{"type":"string","description":"Title of the tab to copy, as sheets_get_metadata lists it"},"destination_spreadsheet_id":{"type":"string","description":"The ID of the spreadsheet the copy is added to"}},"required":["spreadsheet_id","title","destination_spreadsheet_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__sheets_copy_tab_to');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_copy_tab_to: expected 1 row, inserted %', n; END IF;

  -- sheets_get_metadata: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'sheets_get_metadata', 'gws-mcp__sheets_get_metadata',
    'Describes the structure of a Google Sheets spreadsheet without reading any cell. Takes the spreadsheet ID. Returns the spreadsheet''s title, locale, time zone and link, and one entry per tab in tab order: its title, its numeric sheetId, its position, its type, whether it is hidden, its grid size in rows and columns, and how many rows and columns are frozen. The title is what range arguments name a tab by; the sheetId is what sheets_batch_update requests address a tab by. Cell values, formulas and formatting are not part of the response at any spreadsheet size.',
    '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID (from the URL)"}},"required":["spreadsheet_id"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__sheets_get_metadata');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_get_metadata: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 77 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 77, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('calendar_list_events', 'drive_get_file', 'drive_move_file', 'drive_trash_file', 'gmail_get_attachment', 'gmail_list_drafts', 'gmail_trash', 'gmail_untrash', 'gws_run', 'sheets_copy_tab_to', 'sheets_get_metadata');
COMMIT;
