-- Registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway cba2a86554a9707df00ba4c2081533c5982fd515 (what is running) and 2c430114043d8a7b05b490786d64e755b85a8cab.
-- Part 1 of 3: rows split in name order, at most 40 to a part; each part stands alone.
-- 40 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   changes calendar_create_event: destructive_hint
--   changes calendar_delete_event: destructive_hint
--   changes calendar_freebusy: destructive_hint
--   changes calendar_get_event: destructive_hint
--   changes calendar_list_calendars: destructive_hint
--   changes calendar_list_events: destructive_hint
--   changes calendar_respond_to_event: destructive_hint
--   changes calendar_suggest_time: destructive_hint
--   changes calendar_update_event: destructive_hint
--   changes contacts_create: destructive_hint
--   changes contacts_delete: destructive_hint
--   changes contacts_directory_search: destructive_hint
--   changes contacts_get: destructive_hint
--   changes contacts_list: destructive_hint
--   changes contacts_search: destructive_hint
--   changes contacts_update: destructive_hint
--   changes docs_batch_update: destructive_hint
--   changes docs_create: destructive_hint
--   changes docs_delete: destructive_hint
--   changes docs_get: destructive_hint
--   changes docs_write: destructive_hint
--   changes drive_copy_file: destructive_hint
--   changes drive_create_folder: destructive_hint
--   changes drive_get_file: destructive_hint
--   changes drive_get_file_permissions: destructive_hint
--   changes drive_list_recent_files: destructive_hint
--   changes drive_move_file: destructive_hint
--   changes drive_read_file: destructive_hint
--   changes drive_rename_file: destructive_hint
--   changes drive_search: destructive_hint
--   changes drive_share_file: destructive_hint
--   changes drive_trash_file: destructive_hint
--   changes drive_upload_file: destructive_hint
--   changes gmail_create_draft: destructive_hint
--   changes gmail_create_label: destructive_hint
--   changes gmail_delete_draft: destructive_hint
--   changes gmail_delete_label: destructive_hint
--   changes gmail_forward: destructive_hint
--   changes gmail_get_attachment: destructive_hint
--   changes gmail_label_message: destructive_hint
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
  -- calendar_create_event
  UPDATE tools t SET description = 'Create a new calendar event. Supports setting title, time, attendees, description, location, and Google Meet links.', input_schema_json = '{"type":"object","properties":{"summary":{"type":"string","description":"Event title"},"start":{"type":"string","description":"Start time in ISO 8601 format (e.g., \"2024-06-15T14:00:00-07:00\")"},"end":{"type":"string","description":"End time in ISO 8601 format (e.g., \"2024-06-15T15:00:00-07:00\")"},"attendees":{"type":"string","description":"Comma-separated email addresses of attendees"},"description":{"type":"string","description":"Event description or agenda"},"location":{"type":"string","description":"Event location (physical address or room name)"},"add_meet":{"type":"boolean","description":"Attach a Google Meet video conference link to the event (default: false)"},"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\")"},"send_updates":{"type":"string","enum":["all","externalOnly","none"],"description":"Who to send invite notifications to (default: \"all\")"}},"required":["summary","start","end"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_create_event'
    AND md5(t.description) = '7850473bbdc893ff8ea5cb4cd12c2937'
    AND md5(t.input_schema_json::text) = 'de14c5b13b890ae3c753977588949245'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_create_event: expected 1 row, updated %', n; END IF;

  -- calendar_delete_event
  UPDATE tools t SET description = 'Delete a calendar event by its event ID.', input_schema_json = '{"type":"object","properties":{"event_id":{"type":"string","description":"The calendar event ID to delete"},"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\")"},"send_updates":{"type":"string","enum":["all","externalOnly","none"],"description":"Who to send cancellation notifications to (default: \"all\")"}},"required":["event_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_delete_event'
    AND md5(t.description) = '4eccdf6e7344acea61700b1fc15d879c'
    AND md5(t.input_schema_json::text) = 'ad5d5cdefde4f8628c51c83c7c900d68'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_delete_event: expected 1 row, updated %', n; END IF;

  -- calendar_freebusy
  UPDATE tools t SET description = 'Check availability (free/busy) for one or more people over a time range. Useful for finding open slots to schedule meetings.', input_schema_json = '{"type":"object","properties":{"time_min":{"type":"string","description":"Start of the time range to check (ISO 8601)"},"time_max":{"type":"string","description":"End of the time range to check (ISO 8601)"},"emails":{"type":"string","description":"Comma-separated email addresses to check availability for"}},"required":["time_min","time_max","emails"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_freebusy'
    AND md5(t.description) = 'df08081f60092a59e1123f17645d9247'
    AND md5(t.input_schema_json::text) = '830a9cfa041458b2b1501a4a85d5117b'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_freebusy: expected 1 row, updated %', n; END IF;

  -- calendar_get_event
  UPDATE tools t SET description = 'Get details of a specific calendar event by its event ID. Returns the full event (all attendees, reminders, conference data), with the description converted to plain text; use full for the original (often HTML) description.', input_schema_json = '{"type":"object","properties":{"event_id":{"type":"string","description":"The calendar event ID"},"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\")"},"full":{"type":"boolean","description":"Keep the description exactly as stored (often multi-KB HTML from Zoom/scheduling tools) instead of converting it to plain text."}},"required":["event_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_get_event'
    AND md5(t.description) = '5ebb81ddd9bd8f4ccbb8e288044a628d'
    AND md5(t.input_schema_json::text) = '6517f376f6f60f7ff3510711bf5f93c1'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_get_event: expected 1 row, updated %', n; END IF;

  -- calendar_list_calendars
  UPDATE tools t SET description = 'Lists the calendars on the connected account''s calendar list: its own, shared ones it has added, and subscribed ones such as holidays. Returns one compact entry per calendar: its ID, title, whether it is the primary calendar, the account''s access role (owner, writer, reader or freeBusyReader) and its time zone, plus a page token when more remain. The ID is what calendar_list_events and the other calendar tools take as calendar_id.', input_schema_json = '{"type":"object","properties":{"max_results":{"type":"number","description":"The most calendars to return in one page (default: 50, at most 250)."},"page_token":{"type":"string","description":"The nextPageToken from an earlier call, to read the page after it."}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_list_calendars'
    AND md5(t.description) = '048b0acd07c761e72c1cfe9dc0835cbc'
    AND md5(t.input_schema_json::text) = 'a55f87438be0bd2233ced77bc577bdcd'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_list_calendars: expected 1 row, updated %', n; END IF;

  -- calendar_list_events
  UPDATE tools t SET description = 'List upcoming events from a Google Calendar. By default returns a compact view per event: id, title, start/end, location, plain-text description (HTML stripped, truncated), organizer email, attendee count plus your own response status, the full attendee roster when the meeting has 10 or fewer people, a recurring flag, attachments, and the video join link (Meet or conference-data providers like Zoom). Only large-meeting rosters, reminders, and raw HTML are dropped — use full for the raw Calendar API payload, or calendar_get_event for one event''s complete detail.', input_schema_json = '{"type":"object","properties":{"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\" for the user''s main calendar)"},"time_min":{"type":"string","description":"Start of time range (ISO 8601, e.g., \"2024-06-01T00:00:00Z\"). Defaults to now."},"time_max":{"type":"string","description":"End of time range (ISO 8601, e.g., \"2024-06-30T23:59:59Z\"). Defaults to 7 days from now."},"max_results":{"type":"number","description":"Maximum number of events to return (default: 20)"},"query":{"type":"string","description":"Free-text search query to filter events"},"page_token":{"type":"string","description":"The nextPageToken from an earlier call with the same calendar, time range and query, to read the page of events after it."},"full":{"type":"boolean","description":"Return the raw Calendar API response instead of the compact view: full attendee rosters, reminders, conferenceData, htmlLink, and original (often HTML) descriptions. On busy calendars this can be very large — prefer the default compact view for triage and agenda use."},"max_description_chars":{"type":"number","description":"In the compact view, truncate each event''s plain-text description to this many characters (default: 500; adds a truncation marker). Set to 0 to omit descriptions entirely. Ignored when full is true."}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_list_events'
    AND md5(t.description) = 'a6c0598cf0d288f4eb89c5a07d06859d'
    AND md5(t.input_schema_json::text) = '492bac3cbc33744fafa1ea98f2cdad8d'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_list_events: expected 1 row, updated %', n; END IF;

  -- calendar_respond_to_event
  UPDATE tools t SET description = 'Answers an invitation on the connected account''s calendar: accepted, declined or tentative, with an optional note to the organizer. Takes the event ID and the response. The account has to be on the event''s guest list; an event it is not invited to is refused with a message saying so. Returns the event ID, its title, the response now recorded and the note. With send_updates left at its default the organizer is told, as when a person answers in Google Calendar.', input_schema_json = '{"type":"object","properties":{"event_id":{"type":"string","description":"The ID of the event to answer, as calendar_list_events and calendar_get_event return it."},"response":{"type":"string","enum":["accepted","declined","tentative"],"description":"The answer to record: accepted, declined or tentative."},"comment":{"type":"string","description":"An optional note to the organizer, shown beside the answer."},"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\")"},"send_updates":{"type":"string","enum":["all","externalOnly","none"],"description":"Who to send response notifications to (default: \"all\")"}},"required":["event_id","response"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_respond_to_event'
    AND md5(t.description) = '6047371c3daff30343fbcb284b55f58d'
    AND md5(t.input_schema_json::text) = '6e32ef5ae6f5d2a87004e23c89df7ed4'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_respond_to_event: expected 1 row, updated %', n; END IF;

  -- calendar_suggest_time
  UPDATE tools t SET description = 'Suggests meeting times when everyone named is free. Takes the attendees'' addresses, a duration and a time range, and reads their free/busy along with the connected account''s own. Returns candidate start and end times inside working hours, in order of time, each as an ISO time and as a local time in the time zone used. Working hours default to 9 to 17 in the account''s primary calendar time zone, and weekends are skipped unless include_weekends is true. Starts fall on the quarter hour. An attendee whose free/busy cannot be read (another organization that does not share it, or a misspelled address) is listed under could_not_check, and the suggestions then leave that person out. The range can span at most 31 days. Nothing is booked; calendar_create_event books a chosen slot.', input_schema_json = '{"type":"object","properties":{"attendees":{"type":"string","description":"Comma-separated email addresses of the people to find a time for."},"duration_minutes":{"type":"number","description":"How long the meeting is, in minutes (5 to 480)."},"time_min":{"type":"string","description":"Start of the range to search (ISO 8601)."},"time_max":{"type":"string","description":"End of the range to search (ISO 8601), at most 31 days after time_min."},"time_zone":{"type":"string","description":"The IANA time zone working hours are read in, such as \"Europe/London\" (default: the primary calendar''s time zone)."},"working_hours_start":{"type":"number","description":"The hour the working day starts, 0 to 23 (default: 9)."},"working_hours_end":{"type":"number","description":"The hour the working day ends, 1 to 24 (default: 17)."},"include_weekends":{"type":"boolean","description":"Whether Saturdays and Sundays can be suggested (default: false)."},"include_self":{"type":"boolean","description":"Whether the connected account''s own calendar counts as busy time (default: true)."},"max_suggestions":{"type":"number","description":"The most slots to return (default: 5, at most 20)."}},"required":["attendees","duration_minutes","time_min","time_max"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_suggest_time'
    AND md5(t.description) = '280e3e230256d3f66e8348bde9f6b6bc'
    AND md5(t.input_schema_json::text) = 'ac50f53c51ac48a732988bc345803460'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_suggest_time: expected 1 row, updated %', n; END IF;

  -- calendar_update_event
  UPDATE tools t SET description = 'Update an existing calendar event. Only provided fields are changed.', input_schema_json = '{"type":"object","properties":{"event_id":{"type":"string","description":"The calendar event ID to update"},"summary":{"type":"string","description":"New event title"},"start":{"type":"string","description":"New start time (ISO 8601)"},"end":{"type":"string","description":"New end time (ISO 8601)"},"attendees":{"type":"string","description":"Comma-separated email addresses (replaces existing attendees)"},"description":{"type":"string","description":"New event description"},"location":{"type":"string","description":"New event location"},"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\")"},"send_updates":{"type":"string","enum":["all","externalOnly","none"],"description":"Who to send update notifications to (default: \"all\")"}},"required":["event_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_update_event'
    AND md5(t.description) = '3dbcc55297d2835d6250ed20cfaa0666'
    AND md5(t.input_schema_json::text) = 'b5d0fd206fda3346166bc05f2fd41daf'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_update_event: expected 1 row, updated %', n; END IF;

  -- contacts_create
  UPDATE tools t SET description = 'Create a new contact in Google Contacts.', input_schema_json = '{"type":"object","properties":{"name":{"type":"string","description":"Full name of the contact"},"email":{"type":"string","description":"Email address"},"phone":{"type":"string","description":"Phone number"},"company":{"type":"string","description":"Company or organization name"},"title":{"type":"string","description":"Job title"},"notes":{"type":"string","description":"Notes about the contact"}},"required":["name"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'contacts_create'
    AND md5(t.description) = '2c208feea6a2dd265c7f4053809c53a2'
    AND md5(t.input_schema_json::text) = 'e7b142e3be60fce60832478b09553c95'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_create: expected 1 row, updated %', n; END IF;

  -- contacts_delete
  UPDATE tools t SET description = 'Delete a contact from Google Contacts.', input_schema_json = '{"type":"object","properties":{"resource_name":{"type":"string","description":"Contact resource name (e.g., \"people/c1234567890\")"}},"required":["resource_name"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'contacts_delete'
    AND md5(t.description) = '01556ec5de95cf18525848843c939acd'
    AND md5(t.input_schema_json::text) = 'bf22f08c265726562573e3d363c10ca2'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_delete: expected 1 row, updated %', n; END IF;

  -- contacts_directory_search
  UPDATE tools t SET description = 'Search the company''s Google Workspace directory (all users in the organization). Useful for finding colleagues'' contact info.', input_schema_json = '{"type":"object","properties":{"query":{"type":"string","description":"Search query (name, email, or department)"},"max_results":{"type":"number","description":"Maximum number of results (default: 10)"}},"required":["query"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'contacts_directory_search'
    AND md5(t.description) = '5026d2d07ffcdba5afbf6d13c2e2258f'
    AND md5(t.input_schema_json::text) = '59b9ff28e3b4f36edbae1a952b83e15f'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_directory_search: expected 1 row, updated %', n; END IF;

  -- contacts_get
  UPDATE tools t SET description = 'Get full details of a specific contact by their resource name.', input_schema_json = '{"type":"object","properties":{"resource_name":{"type":"string","description":"Contact resource name (e.g., \"people/c1234567890\")"}},"required":["resource_name"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'contacts_get'
    AND md5(t.description) = 'bcc5a3123a9fad5f79db5dd807915e76'
    AND md5(t.input_schema_json::text) = 'bf22f08c265726562573e3d363c10ca2'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_get: expected 1 row, updated %', n; END IF;

  -- contacts_list
  UPDATE tools t SET description = 'List contacts from the user''s Google Contacts. Returns names, emails, phone numbers, and organizations.', input_schema_json = '{"type":"object","properties":{"max_results":{"type":"number","description":"Maximum number of contacts to return (default: 20)"}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'contacts_list'
    AND md5(t.description) = '7426fa17bfc61c8b21468593c22381a0'
    AND md5(t.input_schema_json::text) = '26d8ea924c795198258766232e10f0e8'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_list: expected 1 row, updated %', n; END IF;

  -- contacts_search
  UPDATE tools t SET description = 'Search Google Contacts by name, email, or phone number. Returns matching contacts with their details.', input_schema_json = '{"type":"object","properties":{"query":{"type":"string","description":"Search query (name, email, phone number, or company name)"},"max_results":{"type":"number","description":"Maximum number of contacts to return (default: 10)"}},"required":["query"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'contacts_search'
    AND md5(t.description) = 'b0db1d133d69c64fc20d62ce3f6b6769'
    AND md5(t.input_schema_json::text) = 'a60ae3846220de7a3b7edaaf55f69ee6'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_search: expected 1 row, updated %', n; END IF;

  -- contacts_update
  UPDATE tools t SET description = 'Update an existing contact. Only provided fields are changed.', input_schema_json = '{"type":"object","properties":{"resource_name":{"type":"string","description":"Contact resource name (e.g., \"people/c1234567890\")"},"name":{"type":"string","description":"Updated full name"},"email":{"type":"string","description":"Updated email address"},"phone":{"type":"string","description":"Updated phone number"},"company":{"type":"string","description":"Updated company name"},"title":{"type":"string","description":"Updated job title"},"notes":{"type":"string","description":"Updated notes"}},"required":["resource_name"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'contacts_update'
    AND md5(t.description) = '71914b84eeae651ebd17f15e613203bd'
    AND md5(t.input_schema_json::text) = '02708b2479cbd01191401e1989f30314'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_update: expected 1 row, updated %', n; END IF;

  -- docs_batch_update
  UPDATE tools t SET description = 'Apply batch updates to a Google Doc. Supports inserting text, replacing text, deleting content ranges, and other document modifications. Uses the Google Docs API batchUpdate format.', input_schema_json = '{"type":"object","properties":{"document_id":{"type":"string","description":"The Google Docs document ID"},"requests":{"type":"array","description":"Array of Google Docs API request objects, applied in order. Common shapes, with the nesting exactly as the API requires: insertText { insertText: { location: { index: 1 }, text: \"Hello\" } }; replaceAllText { replaceAllText: { containsText: { text: \"old\", matchCase: true }, replaceText: \"new\" } } — note matchCase sits INSIDE containsText, never at the top level of replaceAllText; deleteContentRange { deleteContentRange: { range: { startIndex: 1, endIndex: 10 } } }; updateTextStyle { updateTextStyle: { range: { startIndex: 1, endIndex: 10 }, textStyle: { bold: true }, fields: \"bold\" } } — fields is required and names which textStyle properties to apply. Indices are the character positions docs_get mode \"index\" reports.","items":{"type":"object"}}},"required":["document_id","requests"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'docs_batch_update'
    AND md5(t.description) = 'f5d21007d39bb1430ca9c88a687ebec0'
    AND md5(t.input_schema_json::text) = '86d92352cfd28a6c15c6b0b71b0e7bd5'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward docs_batch_update: expected 1 row, updated %', n; END IF;

  -- docs_create
  UPDATE tools t SET description = 'Create a new Google Doc.', input_schema_json = '{"type":"object","properties":{"title":{"type":"string","description":"Title for the new document"}},"required":["title"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'docs_create'
    AND md5(t.description) = 'a6f392870baca57c29a4d64d44f11c95'
    AND md5(t.input_schema_json::text) = '2ff5fe319dc626b90a96f0d5eb3d266d'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward docs_create: expected 1 row, updated %', n; END IF;

  -- docs_delete
  UPDATE tools t SET description = 'Delete a Google Doc. This permanently removes the document from Drive.', input_schema_json = '{"type":"object","properties":{"document_id":{"type":"string","description":"The document ID to delete"}},"required":["document_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'docs_delete'
    AND md5(t.description) = 'aaca0d8191c9b78db2e062233dfcdbc9'
    AND md5(t.input_schema_json::text) = '94d4fe3e3d3d8023f49d21653c609a90'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward docs_delete: expected 1 row, updated %', n; END IF;

  -- docs_get
  UPDATE tools t SET description = 'Get the content of a Google Doc. Three modes: "text" (default) returns plain text — use for reading/summarizing. "index" returns text with startIndex/endIndex — use before positional edits (insertText at index, deleteContentRange). "full" returns the raw API response — use only for debugging or style operations. To read part of a long document, pass start_index/end_index — the SAME character indices that mode "index" reports and docs_batch_update consumes. A ranged response also reports totalEndIndex, clipped, and nextStartIndex (when more content follows), so a caller can page instead of guessing whether it saw everything. Without a range, behaviour is unchanged and the whole document is returned.', input_schema_json = '{"type":"object","properties":{"document_id":{"type":"string","description":"The Google Docs document ID (from the URL)"},"mode":{"type":"string","enum":["text","index","full"],"description":"\"text\" (default): plain text. \"index\": text with character positions for edits. \"full\": raw API response."},"start_index":{"type":"number","description":"Return content from this character index (inclusive), in the same index space mode \"index\" reports and docs_batch_update consumes — a document body starts at index 1. Omit to read from the start. Not valid with mode \"full\"."},"end_index":{"type":"number","description":"Return content up to this character index (exclusive), same index space as start_index. Omit to read to the end."}},"required":["document_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'docs_get'
    AND md5(t.description) = '2f368d4e8ae6a0e22abf562d9124b18b'
    AND md5(t.input_schema_json::text) = '4493e89db75db083288604b5498f54fc'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward docs_get: expected 1 row, updated %', n; END IF;

  -- docs_write
  UPDATE tools t SET description = 'Insert text at the beginning of a Google Doc. To append or edit at a specific position, use docs_get (mode ''index'') then docs_batch_update.', input_schema_json = '{"type":"object","properties":{"document_id":{"type":"string","description":"The Google Docs document ID"},"text":{"type":"string","description":"Text content to write to the document"},"content":{"type":"string","x-alias-of":"text","description":"The same as text, under another name. Give text or content, not both. The answer names it under aliased."}},"required":["document_id","text"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'docs_write'
    AND md5(t.description) = '7bb627c515352e22d7b946f5eca1d4e2'
    AND md5(t.input_schema_json::text) = 'ae4570da7d4f7a57fbad44548bfba5ad'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward docs_write: expected 1 row, updated %', n; END IF;

  -- drive_copy_file
  UPDATE tools t SET description = 'Copies a file in Google Drive and names the copy in the same call. The copy carries the original''s tabs, formatting and formulas, so a copied template matches its source. With convert set to true, an Excel, Word or PowerPoint file is copied as a Google Sheet, Doc or Slides file, which the sheets_, docs_ and slides_ tools open; the original is left as it was. Returns the copy''s id, name, MIME type, folders and link. Folders are not copyable: Drive refuses them with a 403 "This file cannot be copied by the user", a limit of the API rather than of permissions.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file ID to copy"},"name":{"type":"string","minLength":1,"description":"Name for the new copy"},"parent_id":{"type":"string","description":"Folder ID to place the copy in (optional, defaults to the original''s folder)"},"convert":{"type":"boolean","description":"When true, the copy of an Excel, Word or PowerPoint file is a Google Sheet, Doc or Slides file (.xlsx and .xls to Sheets, .docx and .doc to Docs, .pptx and .ppt to Slides). A file of any other type is refused and nothing is copied. Defaults to false, a copy of the same type."}},"required":["file_id","name"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_copy_file'
    AND md5(t.description) = '28bc3945de11f7c8aa803e8bed5e59a9'
    AND md5(t.input_schema_json::text) = '5892e89af97543c54fe020ff820926d3'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_copy_file: expected 1 row, updated %', n; END IF;

  -- drive_create_folder
  UPDATE tools t SET description = 'Create a new folder in Google Drive.', input_schema_json = '{"type":"object","properties":{"name":{"type":"string","description":"Name for the new folder"},"parent_id":{"type":"string","description":"Parent folder ID to create inside (optional, defaults to root)"}},"required":["name"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_create_folder'
    AND md5(t.description) = 'b5d6f4f50f557fb2f33c6473a7e2e032'
    AND md5(t.input_schema_json::text) = '494a80a0068bb8e19da7d9ecb0ac74a5'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_create_folder: expected 1 row, updated %', n; END IF;

  -- drive_get_file
  UPDATE tools t SET description = 'Describes one file or folder in Google Drive without reading its content. Takes the file ID. Returns its name, MIME type, size in bytes when Drive reports one (folders have none), the IDs of the folders it is in, its owners'' names and addresses, when it was created and last modified, its link, whether it is in Trash, whether it is shared, and the shared drive it belongs to when it is in one. A file the account cannot see answers as not found.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to describe"}},"required":["file_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_get_file'
    AND md5(t.description) = '41f390966bb73a1ceae2a54de23c56c5'
    AND md5(t.input_schema_json::text) = 'c2ec4ca2729436853028f77432ad35cf'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_get_file: expected 1 row, updated %', n; END IF;

  -- drive_get_file_permissions
  UPDATE tools t SET description = 'Lists who has access to a Google Drive file or folder and at what role. Takes the file ID. Returns one entry per permission: its ID, its type (user, group, domain or anyone), the role (owner, organizer, fileOrganizer, writer, commenter or reader), and the person''s name and address or the domain where there is one. A file the account cannot see answers as not found.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID."}},"required":["file_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_get_file_permissions'
    AND md5(t.description) = 'afcd82f9c69f342cdb067b14bf3cf0f7'
    AND md5(t.input_schema_json::text) = '60832199ecb1d5432e61d8b6c99d5f62'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_get_file_permissions: expected 1 row, updated %', n; END IF;

  -- drive_list_recent_files
  UPDATE tools t SET description = 'Lists the Google Drive files the account opened most recently, or the ones modified most recently, the most recent at the top. Returns one compact entry per file: its ID, name, MIME type, when it was last modified, when the account last opened it, and its link, plus a page token when more remain. Files in Trash are left out.', input_schema_json = '{"type":"object","properties":{"by":{"type":"string","enum":["opened","modified"],"description":"Order by when the account last opened each file, or by when each file was last modified by anyone (default: opened)."},"page_size":{"type":"number","description":"The most files to return in one page (default: 20, at most 100)."},"page_token":{"type":"string","description":"The nextPageToken from an earlier call, to read the page after it."}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_list_recent_files'
    AND md5(t.description) = '82622a5e7dc07cab567b17249403040d'
    AND md5(t.input_schema_json::text) = '245e869d9d83c8d96d21ed35f8c95c23'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_list_recent_files: expected 1 row, updated %', n; END IF;

  -- drive_move_file
  UPDATE tools t SET description = 'Moves a file or folder in Google Drive into another folder. Takes the file ID and the destination folder ID. The item is added to the destination folder and removed from the folder or folders it was in, so it ends up in one place; its name, content and ID are unchanged. Returns the item''s ID, name, the folder it is now in and its link. An item already in the destination folder is left where it is and reported as not moved.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to move"},"folder_id":{"type":"string","description":"The ID of the folder to move it into"}},"required":["file_id","folder_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_move_file'
    AND md5(t.description) = '7858bc27cd0d6fe31759f519d4f3d2db'
    AND md5(t.input_schema_json::text) = 'dddc17d5e8f1739e44412b3221c569c2'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_move_file: expected 1 row, updated %', n; END IF;

  -- drive_read_file
  UPDATE tools t SET description = 'Read the text content of any file in Google Drive by file ID. Supports Google Docs, Sheets, Slides, Office formats (.docx/.xlsx/.pptx — auto-converted), and plain text files. Returns extracted text directly — no local filesystem needed.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file ID to read"}},"required":["file_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_read_file'
    AND md5(t.description) = 'bdbd7a8d20a26b4d5d75981f73e54642'
    AND md5(t.input_schema_json::text) = 'b7e45673ccda2dead20995acd57a6c1e'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_read_file: expected 1 row, updated %', n; END IF;

  -- drive_rename_file
  UPDATE tools t SET description = 'Rename a file or folder in Google Drive. Changes the name only: content, location, and sharing are untouched. Works on any Drive item the account can edit, including Docs, Sheets, Slides, and folders.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to rename"},"name":{"type":"string","minLength":1,"description":"The new name"}},"required":["file_id","name"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_rename_file'
    AND md5(t.description) = '1c196af93d78e6b380160e511568c952'
    AND md5(t.input_schema_json::text) = '9e950b669e6084a09e22fd728fa92849'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_rename_file: expected 1 row, updated %', n; END IF;

  -- drive_search
  UPDATE tools t SET description = 'Search for files in Google Drive. Returns file names, IDs, types, and modification dates.', input_schema_json = '{"type":"object","properties":{"query":{"type":"string","description":"Search query (Drive query syntax, e.g., \"name contains ''report''\" or \"mimeType=''application/vnd.google-apps.spreadsheet''\")"},"page_size":{"type":"number","description":"Maximum number of results to return (default: 20)"}},"required":["query"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_search'
    AND md5(t.description) = '73e6f10f5570bec63caa42a5b14b5c4e'
    AND md5(t.input_schema_json::text) = '5df398f8fc46b8f3c35b406f05329f85'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_search: expected 1 row, updated %', n; END IF;

  -- drive_share_file
  UPDATE tools t SET description = 'Shares a Google Drive file or folder with one person by email address, as reader, commenter or writer. Takes the file ID, the address and the role, and optionally a message for the notification email. Google emails the person unless notify is false. Returns the file ID and its permission list afterwards: who has access, at what role. Sharing a file with someone already on it at another role adds no second entry; Drive keeps one per person. This gives the person access to the file and, for a folder, to what is inside it.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to share."},"email":{"type":"string","description":"The email address of the person to share with."},"role":{"type":"string","enum":["reader","commenter","writer"],"description":"The access to give: reader (view), commenter (view and comment) or writer (edit)."},"message":{"type":"string","description":"An optional message, sent in the notification email."},"notify":{"type":"boolean","description":"Whether Google emails the person about the share (default: true)."}},"required":["file_id","email","role"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_share_file'
    AND md5(t.description) = 'f1c76cef2524b1cbff483d6536d8432f'
    AND md5(t.input_schema_json::text) = 'cb6658df1ebbff5de06a9b93ef6794e2'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_share_file: expected 1 row, updated %', n; END IF;

  -- drive_trash_file
  UPDATE tools t SET description = 'Moves a file or folder in Google Drive to Trash. Takes the file ID. The item stays in Trash, where Drive deletes it for good after 30 days and where its owner can restore it before then; trashing a folder trashes what is inside it. Returns the item''s ID, name and its trashed state as Drive reports it afterwards. Works on any Drive item the account is allowed to trash, including Docs, Sheets and Slides.', input_schema_json = '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to move to Trash"}},"required":["file_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_trash_file'
    AND md5(t.description) = 'a9ca497623c0b6d9366b6e3339cd2b67'
    AND md5(t.input_schema_json::text) = '8ad2f9a41b86108d8a8b91796efa2306'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_trash_file: expected 1 row, updated %', n; END IF;

  -- drive_upload_file
  UPDATE tools t SET description = 'Puts a file named by a file reference into Google Drive, under the file''s own name. A reference to a file in Gmail or Drive names where it lives: the gateway fetches it and hands it to Drive, so its bytes never pass through the conversation. A gmail_message reference stores a whole email as its original .eml exactly as Gmail returns it; a gmail_attachment reference stores one attachment of an email, named by the part id gmail_read lists for it. A drive_file reference copies a Drive file as stored, and a drive_export reference stores a Google Docs, Sheets or Slides file exported to a format such as pdf or docx; with a reference''s account naming another connected Google account, this copies a file from one account''s Drive into another''s, which drive_copy_file, working within one account, does not. A content reference carries a file the caller already holds, as standard base64 in the call, at most 1 MB decoded, under the name it gives, and an upload reference names a file the user sent through file_upload_link, up to 25 MB. It goes into folder_id when given, otherwise the root of My Drive, in the Drive of the account the call runs as, which can be a different connected account from the one holding the email or file. The answer is a receipt: the new file''s id, name, size, type, link and parents; the SHA-256 and byte count of what was sent; the SHA-256 and MD5 Drive reports for what it stored, and whether the two SHA-256 values match; and the folder it went into, with its owners, whether it is shared, and whether it is in a shared drive, next to the address of the account that received the file. The folder comes from the user, never from the content of a file. One file a call, at most 25 MB. The upload is not retried, and a second call makes a second file of the same name.', input_schema_json = '{"type":"object","properties":{"file":{"type":"object","description":"A file reference: {\"type\":\"gmail_message\",\"message_id\":\"...\"} for an email, {\"type\":\"gmail_attachment\",\"message_id\":\"...\",\"part_id\":\"...\"} for one attachment, {\"type\":\"drive_file\",\"file_id\":\"...\"} for a Drive file as stored, or {\"type\":\"drive_export\",\"file_id\":\"...\",\"format\":\"pdf\"} for a Google Docs, Sheets or Slides file exported (pdf, docx, xlsx, pptx, csv, txt, md and the other formats each kind takes). An optional \"account\" names the connected Google account that holds the message or file. For a file the caller already holds: {\"type\":\"content\",\"name\":\"<file name>\",\"base64\":\"<standard base64, one unbroken string>\"}, at most 1 MB decoded, with an optional \"mime_type\"; it takes no account. For a file sent through file_upload_link: {\"type\":\"upload\",\"upload_id\":\"<id from its receipt>\"}."},"folder_id":{"type":"string","description":"The Drive folder to put the file in. Omitted: the root of My Drive."}},"required":["file"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_upload_file'
    AND md5(t.description) = 'cdf100f717337d2b45ca0e57478b22e1'
    AND md5(t.input_schema_json::text) = '4492c48387d6b4c92cd63bef54db166d'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_upload_file: expected 1 row, updated %', n; END IF;

  -- gmail_create_draft
  UPDATE tools t SET description = 'Create a draft email in Gmail without sending it. The draft can be reviewed and sent later from Gmail. Returns the draft ID and a link to open it in Gmail. Accepts a plain-text body, an HTML html_body, or both — HTML is stored as multipart/alternative with a plain-text fallback. The account''s Gmail signature is added to the draft automatically, as Gmail''s own Compose does, so do not write a sign-off or signature in the body yourself; pass signature: false to leave it out. The signature goes in the draft''s HTML part, so a plain-text body is stored as multipart/alternative when the account has one. The response''s signature field reports what happened.', input_schema_json = '{"type":"object","properties":{"to":{"type":"string","description":"Recipient email address(es), comma-separated"},"subject":{"type":"string","description":"Email subject line"},"body":{"type":"string","description":"Plain-text email body. When html_body is also given, this becomes the text/plain alternative part shown by plain-text clients. One of body or html_body is required."},"html_body":{"type":"string","description":"HTML email body. The message is sent as multipart/alternative with a text/plain fallback part (body if provided, otherwise text derived from the HTML), so plain-text clients still render something readable."},"cc":{"type":"string","description":"CC recipients, comma-separated"},"bcc":{"type":"string","description":"BCC recipients, comma-separated"},"attachments":{"type":"array","maxItems":10,"description":"Files to send with the message, at most 10, 25 MB in total. Each entry is a Drive file id as a string, or {\"file_id\": \"<id>\", \"as\": \"<format>\"} to send a Google Doc, Sheet or Slides deck as a file, or a file reference. Formats: Docs pdf, docx, txt, html, md, rtf, odt, epub; Sheets pdf, xlsx, csv, tsv, html, ods; Slides pdf, pptx, txt, odp. csv and tsv export one tab: add \"tab\": \"<title>\" to choose it, otherwise the first tab goes, and the response says which. A Sheet as html arrives as a .zip of pages, one per tab; Slides as txt is the slides'' visible text only. Google Docs, Sheets and Slides passed by id alone are sent as links in the message, the way Gmail does, not as files. Other Drive files are attached as they are. A file reference is an object with a \"type\": {\"type\": \"gmail_message\", \"message_id\": \"<id>\"} attaches an email as its original .eml, {\"type\": \"gmail_attachment\", \"message_id\": \"<id>\", \"part_id\": \"<part id>\"} one attachment of an email, {\"type\": \"drive_file\", \"file_id\": \"<id>\"} a Drive file as stored, {\"type\": \"drive_export\", \"file_id\": \"<id>\", \"format\": \"pdf\"} a Google file exported, {\"type\": \"content\", \"name\": \"<file name>\", \"base64\": \"<standard base64, one unbroken string>\"} a file the caller already holds, at most 1 MB, and {\"type\": \"upload\", \"upload_id\": \"<id>\"} a file the user sent through file_upload_link. A reference may carry an \"account\" naming the connected Google account that holds the email or file. Several entries may be references. Two attachments may not share a filename. To show an image in the body rather than at the bottom, reference it in html_body as <img src=\"cid:FILENAME\">, where FILENAME is its Drive filename with any character other than letters, digits, dot, dash and underscore replaced by an underscore. Sharing a Drive link is the sender''s responsibility; nothing here changes who can open a file. The response''s attachments field reports each file as attached, inline, linked or exported, with its size and the SHA-256 of the bytes that went into the message; a file sent as a link has neither.","items":{"anyOf":[{"type":"string","description":"A Drive file id."},{"type":"object","properties":{"file_id":{"type":"string","description":"A Drive file id."},"as":{"type":"string","enum":["pdf","docx","txt","html","md","rtf","odt","epub","xlsx","csv","tsv","ods","pptx","odp"],"description":"Export a Google Doc, Sheet or Slides deck in this format."},"tab":{"type":"string","description":"For a Sheet as csv or tsv: the tab to export, by title. Defaults to the first tab."}},"required":["file_id"]},{"type":"object","description":"A file reference, resolved by the gateway and attached in this entry''s place.","properties":{"type":{"type":"string","enum":["gmail_message","gmail_attachment","drive_file","drive_export","content","upload"],"description":"The kind of file reference."},"message_id":{"type":"string","description":"With gmail_message and gmail_attachment: the Gmail message id."},"part_id":{"type":"string","description":"With gmail_attachment: the attachment''s part id as gmail_read lists it."},"file_id":{"type":"string","description":"With drive_file and drive_export: the Drive file id."},"format":{"type":"string","description":"With drive_export: the format to export to, such as pdf."},"account":{"type":"string","description":"Which connected Google account holds the email or file. Not taken with content."},"name":{"type":"string","description":"With content: the file''s name, with its extension."},"base64":{"type":"string","description":"With content: the file in standard base64 as one unbroken string, at most 1 MB decoded."},"mime_type":{"type":"string","description":"With content, optional: the file''s type; omitted, it comes from the name''s extension."},"upload_id":{"type":"string","description":"With upload: the id from the receipt of a file sent through file_upload_link."}},"required":["type"]}]}},"signature":{"type":"boolean","description":"Set false to write the draft without the account''s Gmail signature, and to skip the lookup entirely. Defaults to true."}},"required":["to","subject"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_create_draft'
    AND md5(t.description) = 'a375d8eefad6b4e6079dee1208fefc21'
    AND md5(t.input_schema_json::text) = 'dc907fb213b2c9ba4aa914d91d355d77'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_create_draft: expected 1 row, updated %', n; END IF;

  -- gmail_create_label
  UPDATE tools t SET description = 'Create a Gmail label, or find it if it already exists. Nested labels use ''/'' in the name (e.g. ''Alerts/Invoices''). Returns the label including its ID, which can be used with gmail_label_message; when a label with that name already exists the existing label is returned as found (existed: true), so it is safe to call once per run without listing labels first.', input_schema_json = '{"type":"object","properties":{"name":{"type":"string","description":"The label name to create"}},"required":["name"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_create_label'
    AND md5(t.description) = '28788825b57a4b536f3da446a3138b16'
    AND md5(t.input_schema_json::text) = '25b6e4e46f7cd7a8f7b04e1508e5bccd'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_create_label: expected 1 row, updated %', n; END IF;

  -- gmail_delete_draft
  UPDATE tools t SET description = 'Permanently delete a Gmail draft by its draft ID. This does not move the draft to Trash — it is removed immediately. Use gmail_send_draft to send a draft instead of deleting it.', input_schema_json = '{"type":"object","properties":{"draft_id":{"type":"string","description":"The Gmail draft ID to delete"}},"required":["draft_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_delete_draft'
    AND md5(t.description) = '6249ea286d70ecfa1e60c3c93c19df83'
    AND md5(t.input_schema_json::text) = 'c180ac310d7057186a004e00abdc268e'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_delete_draft: expected 1 row, updated %', n; END IF;

  -- gmail_delete_label
  UPDATE tools t SET description = 'Delete a Gmail label. Takes the label ID (from gmail_list_labels), not the label name. This removes the label from every message that carries it; the messages themselves are not deleted. System labels (INBOX, UNREAD, SENT) cannot be deleted.', input_schema_json = '{"type":"object","properties":{"label_id":{"type":"string","description":"The label ID to delete (from gmail_list_labels)"}},"required":["label_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_delete_label'
    AND md5(t.description) = '68513c7409911372b36618ee9f2772fd'
    AND md5(t.input_schema_json::text) = '3a92a87c16c8af4f7af2a315d800fc81'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_delete_label: expected 1 row, updated %', n; END IF;

  -- gmail_forward
  UPDATE tools t SET description = 'Forward an existing email to another recipient. The account''s Gmail signature is appended automatically, so do not write a sign-off or signature in the body yourself; pass signature: false to send without it. The signature goes in the message''s HTML part, so a plain-text body is sent as multipart/alternative when the account has one. The response''s signature field reports what happened.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The Gmail message ID to forward"},"to":{"type":"string","description":"Recipient email address to forward to"},"body":{"type":"string","description":"Optional plain-text note included above the forwarded message"},"html_body":{"type":"string","description":"Optional HTML note included above the forwarded message. The forward goes out with both an HTML part and a plain-text part, and the forwarded block is formatted with Gmail styling. Provide body or html_body, not both."},"attachments":{"type":"array","maxItems":10,"description":"Files to send with the message, at most 10, 25 MB in total. Each entry is a Drive file id as a string, or {\"file_id\": \"<id>\", \"as\": \"<format>\"} to send a Google Doc, Sheet or Slides deck as a file, or a file reference. Formats: Docs pdf, docx, txt, html, md, rtf, odt, epub; Sheets pdf, xlsx, csv, tsv, html, ods; Slides pdf, pptx, txt, odp. csv and tsv export one tab: add \"tab\": \"<title>\" to choose it, otherwise the first tab goes, and the response says which. A Sheet as html arrives as a .zip of pages, one per tab; Slides as txt is the slides'' visible text only. Google Docs, Sheets and Slides passed by id alone are sent as links in the message, the way Gmail does, not as files. Other Drive files are attached as they are. A file reference is an object with a \"type\": {\"type\": \"gmail_message\", \"message_id\": \"<id>\"} attaches an email as its original .eml, {\"type\": \"gmail_attachment\", \"message_id\": \"<id>\", \"part_id\": \"<part id>\"} one attachment of an email, {\"type\": \"drive_file\", \"file_id\": \"<id>\"} a Drive file as stored, {\"type\": \"drive_export\", \"file_id\": \"<id>\", \"format\": \"pdf\"} a Google file exported, {\"type\": \"content\", \"name\": \"<file name>\", \"base64\": \"<standard base64, one unbroken string>\"} a file the caller already holds, at most 1 MB, and {\"type\": \"upload\", \"upload_id\": \"<id>\"} a file the user sent through file_upload_link. A reference may carry an \"account\" naming the connected Google account that holds the email or file. Several entries may be references. Two attachments may not share a filename. To show an image in the body rather than at the bottom, reference it in html_body as <img src=\"cid:FILENAME\">, where FILENAME is its Drive filename with any character other than letters, digits, dot, dash and underscore replaced by an underscore. Sharing a Drive link is the sender''s responsibility; nothing here changes who can open a file. The response''s attachments field reports each file as attached, inline, linked or exported, with its size and the SHA-256 of the bytes that went into the message; a file sent as a link has neither.","items":{"anyOf":[{"type":"string","description":"A Drive file id."},{"type":"object","properties":{"file_id":{"type":"string","description":"A Drive file id."},"as":{"type":"string","enum":["pdf","docx","txt","html","md","rtf","odt","epub","xlsx","csv","tsv","ods","pptx","odp"],"description":"Export a Google Doc, Sheet or Slides deck in this format."},"tab":{"type":"string","description":"For a Sheet as csv or tsv: the tab to export, by title. Defaults to the first tab."}},"required":["file_id"]},{"type":"object","description":"A file reference, resolved by the gateway and attached in this entry''s place.","properties":{"type":{"type":"string","enum":["gmail_message","gmail_attachment","drive_file","drive_export","content","upload"],"description":"The kind of file reference."},"message_id":{"type":"string","description":"With gmail_message and gmail_attachment: the Gmail message id."},"part_id":{"type":"string","description":"With gmail_attachment: the attachment''s part id as gmail_read lists it."},"file_id":{"type":"string","description":"With drive_file and drive_export: the Drive file id."},"format":{"type":"string","description":"With drive_export: the format to export to, such as pdf."},"account":{"type":"string","description":"Which connected Google account holds the email or file. Not taken with content."},"name":{"type":"string","description":"With content: the file''s name, with its extension."},"base64":{"type":"string","description":"With content: the file in standard base64 as one unbroken string, at most 1 MB decoded."},"mime_type":{"type":"string","description":"With content, optional: the file''s type; omitted, it comes from the name''s extension."},"upload_id":{"type":"string","description":"With upload: the id from the receipt of a file sent through file_upload_link."}},"required":["type"]}]}},"include_original_attachments":{"type":"boolean","description":"The original message''s own attachments are forwarded with it, counted in the 25 MB limit. Set false to forward the text alone. Defaults to true."},"signature":{"type":"boolean","description":"Set false to send without the account''s Gmail signature, and to skip the lookup entirely. Defaults to true."}},"required":["message_id","to"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_forward'
    AND md5(t.description) = '272a6fe6895542926caa724915f1f9db'
    AND md5(t.input_schema_json::text) = 'c66ef890309f38103a25a6870a0ea19d'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_forward: expected 1 row, updated %', n; END IF;

  -- gmail_get_attachment
  UPDATE tools t SET description = 'Gets one attachment of a Gmail message by the message ID and the attachment''s part ID, both of which gmail_read lists for each attachment. Describes the attachment and, when it is text, returns that text. Every response carries the file name, MIME type, size in bytes and a current attachment ID. For a text attachment (plain text, CSV, JSON, XML, HTML, calendar files and similar) of up to 0.5 MB, the response also carries the content as text, cut at 200,000 characters with a marker saying how much was left out, and with characters that cannot be seen removed. For any other type, or a larger file, no content is returned: the response states the size and the reason, and the attachment ID it carries is the one gmail_save_attachment_to_drive takes to put the file in Drive, where drive_read_file reads Word, Excel and PowerPoint files. File bytes are not returned as base64 for any type.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message the attachment is on."},"part_id":{"type":"string","description":"The attachment''s part ID from gmail_read, such as \"1\" or \"0.1\". It is the attachment''s place in the message and is the same on every read, where an attachment ID is issued new each time."}},"required":["message_id","part_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_get_attachment'
    AND md5(t.description) = '2d337a07afc781fb14ce00a7b420c0e4'
    AND md5(t.input_schema_json::text) = '14a75cb88f7328502678fd9f7f1ac6eb'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_get_attachment: expected 1 row, updated %', n; END IF;

  -- gmail_label_message
  UPDATE tools t SET description = 'Label many messages in ONE call: pass message_ids (up to 1000) with add_labels and/or remove_labels, and every message is modified by a single users.messages.batchModify request. Do not call this once per message. The label-and-mark-read pair is one call: add_labels: ["<label id>"], remove_labels: ["UNREAD"]. Removing INBOX archives; removing UNREAD marks read. Label IDs come from gmail_list_labels. Returns a per-message outcome (results[]: id, ok, error) so a partial batch is visible; if the batch request is refused, each id is retried on its own and reported. message_id is for a single message only; thread_id labels every message of one conversation.', input_schema_json = '{"type":"object","properties":{"message_ids":{"type":"array","items":{"type":"string"},"description":"The message IDs to modify together in one call, up to 1000. Prefer this over message_id whenever there is more than one message."},"message_id":{"type":"string","description":"A single message ID, for the one-message case only. Provide either this or message_ids."},"thread_id":{"type":"string","description":"A thread ID, to label or unlabel every message in that conversation in one call, as Gmail does when a conversation is selected. Provide this instead of message_id or message_ids."},"add_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to add, e.g. [\"Label_12\"]"},"remove_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to remove, e.g. [\"INBOX\"] to archive or [\"UNREAD\"] to mark read; combine with add_labels to label and mark read in the same call"}},"required":[]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_label_message'
    AND md5(t.description) = '5880627ea7a45a04dd1519ca939fc5a4'
    AND md5(t.input_schema_json::text) = '90268bfd63be487abef2868f7d796fc7'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_label_message: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('calendar_create_event', 'calendar_delete_event', 'calendar_freebusy', 'calendar_get_event', 'calendar_list_calendars', 'calendar_list_events', 'calendar_respond_to_event', 'calendar_suggest_time', 'calendar_update_event', 'contacts_create', 'contacts_delete', 'contacts_directory_search', 'contacts_get', 'contacts_list', 'contacts_search', 'contacts_update', 'docs_batch_update', 'docs_create', 'docs_delete', 'docs_get', 'docs_write', 'drive_copy_file', 'drive_create_folder', 'drive_get_file', 'drive_get_file_permissions', 'drive_list_recent_files', 'drive_move_file', 'drive_read_file', 'drive_rename_file', 'drive_search', 'drive_share_file', 'drive_trash_file', 'drive_upload_file', 'gmail_create_draft', 'gmail_create_label', 'gmail_delete_draft', 'gmail_delete_label', 'gmail_forward', 'gmail_get_attachment', 'gmail_label_message');
COMMIT;
