-- Registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway 258c7d2d4b8abe7231d39c8b12cc515884c82d97 (what is running) and 189078c370a4b1e071bf3dcf171f0fc8dfd5230c.
-- 1 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   changes calendar_list_events: input_schema_json
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
  UPDATE tools t SET description = 'List upcoming events from a Google Calendar. By default returns a compact view per event: id, title, start/end, location, plain-text description (HTML stripped, truncated), organizer email, attendee count plus your own response status, the full attendee roster when the meeting has 10 or fewer people, a recurring flag, attachments, and the video join link (Meet or conference-data providers like Zoom). Only large-meeting rosters, reminders, and raw HTML are dropped — use full for the raw Calendar API payload, or calendar_get_event for one event''s complete detail.', input_schema_json = '{"type":"object","properties":{"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\" for the user''s main calendar)"},"time_min":{"type":"string","description":"Start of time range (ISO 8601, e.g., \"2024-06-01T00:00:00Z\"). Defaults to now."},"time_max":{"type":"string","description":"End of time range (ISO 8601, e.g., \"2024-06-30T23:59:59Z\"). Defaults to 7 days from now."},"max_results":{"type":"number","description":"Maximum number of events to return (default: 20)"},"query":{"type":"string","description":"Free-text search query to filter events"},"page_token":{"type":"string","description":"The nextPageToken from an earlier call with the same calendar, time range and query, to read the page of events after it."},"updated_min":{"type":"string","description":"Only events changed at or after this time (RFC 3339, e.g. \"2024-06-01T00:00:00Z\"), for reading what changed since an earlier call. The time range still applies. Google refuses a time too far in the past (410 updatedMinTooLongAgo), and then a full read is the way back. Optional."},"show_deleted":{"type":"boolean","description":"When true, cancelled and deleted events are included, each with status \"cancelled\". Defaults to false."},"order_by":{"type":"string","enum":["startTime","updated"],"description":"\"startTime\" (default) orders events by when they start; \"updated\" orders them by when they were last changed."},"full":{"type":"boolean","description":"Return the raw Calendar API response instead of the compact view: full attendee rosters, reminders, conferenceData, htmlLink, and original (often HTML) descriptions. On busy calendars this can be very large — prefer the default compact view for triage and agenda use."},"max_description_chars":{"type":"number","description":"In the compact view, truncate each event''s plain-text description to this many characters (default: 500; adds a truncation marker). Set to 0 to omit descriptions entirely. Ignored when full is true."}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_list_events'
    AND md5(t.description) = 'a6c0598cf0d288f4eb89c5a07d06859d'
    AND md5(t.input_schema_json::text) = '492bac3cbc33744fafa1ea98f2cdad8d'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_list_events: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('calendar_list_events');
COMMIT;
