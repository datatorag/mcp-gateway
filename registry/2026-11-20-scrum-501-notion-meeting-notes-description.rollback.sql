-- ROLLBACK of the registry change for notion-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway 61c85b08d507b81c3134dbea4b8ae56c91690659 served, from what 2c10be6afbdd6b38d38272d20eab19c3787af07a served.
-- 1 row(s) change, 0 added, 0 removed.
-- Rows for notion-mcp: 20 before, 20 after.
--   restores notion_list_meeting_notes: description
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
  -- notion_list_meeting_notes
  UPDATE tools t SET description = 'Lists the Notion AI meeting notes of meetings the connected Notion user attended, the newest at the top, created on or after a date and optionally on or before another, and optionally only those whose title contains some text. Each note carries its id, title, the meeting''s start and end time, its attendees (names where Notion gives them), its status, the AI summary and the notes as text, and action_items: every to-do in the summary and notes with whether it is checked, and every list item under a heading that says action items or next steps. The transcript is left out unless include_transcript is true. The text of one answer is held to max_body_chars together (default 100,000): when there is more, the oldest notes keep their title and times but not their text, and left_out lists their ids. Notion returns at most 50 notes and no cursor; has_more true means more notes match than were returned, and a narrower date range reads the rest. Notes still being transcribed or summarized come back with their status and no summary. A workspace without Notion AI meeting notes answers with a sentence saying so.', input_schema_json = '{"type":"object","properties":{"since":{"type":"string","description":"Notes created on or after this day: a date as YYYY-MM-DD, or one of today, yesterday, one_week_ago. Default yesterday."},"until":{"type":"string","description":"Notes created on or before this day: a date as YYYY-MM-DD, or one of today, yesterday, one_week_ago. Absent means up to now."},"title":{"type":"string","description":"Only notes whose title contains this text."},"include_transcript":{"type":"boolean","description":"Whether each note carries its transcript as text. Default false."},"limit":{"type":"integer","minimum":1,"maximum":50,"description":"How many notes, from 1 to 50. Default 10."},"max_body_chars":{"type":"integer","minimum":1000,"maximum":200000,"description":"The text of all notes in one answer, together, in characters. Default 100,000, at most 200,000."}}}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_list_meeting_notes'
    AND md5(t.description) = '060def701b1fbb35762456a0177451cc'
    AND md5(t.input_schema_json::text) = '19b7fd650c69051862cc447c1aec77dd'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_list_meeting_notes: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'notion-mcp';
  IF n <> 20 THEN RAISE EXCEPTION 'rows for notion-mcp: expected 20, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'notion-mcp' AND t.name IN ('notion_list_meeting_notes');
COMMIT;
