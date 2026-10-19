-- Registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway c85ae9f95dffae95df6c615eec1ee0ebc9eb1484 (what is running) and f9ac5f77635a505d839e14eb5b8c1b3683210d3c.
-- 1 row(s) change, 10 added, 0 removed.
-- Rows for gws-mcp: 77 before, 87 after.
--   changes gmail_label_message: description, input_schema_json
--   adds calendar_list_calendars
--   adds calendar_respond_to_event
--   adds calendar_suggest_time
--   adds drive_get_file_permissions
--   adds drive_list_recent_files
--   adds drive_share_file
--   adds gmail_mark_spam
--   adds gmail_trash_thread
--   adds gmail_unmark_spam
--   adds gmail_untrash_thread
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
  -- gmail_label_message
  UPDATE tools t SET description = 'Label many messages in ONE call: pass message_ids (up to 1000) with add_labels and/or remove_labels, and every message is modified by a single users.messages.batchModify request. Do not call this once per message. The label-and-mark-read pair is one call: add_labels: ["<label id>"], remove_labels: ["UNREAD"]. Removing INBOX archives; removing UNREAD marks read. Label IDs come from gmail_list_labels. Returns a per-message outcome (results[]: id, ok, error) so a partial batch is visible; if the batch request is refused, each id is retried on its own and reported. message_id is for a single message only; thread_id labels every message of one conversation.', input_schema_json = '{"type":"object","properties":{"message_ids":{"type":"array","items":{"type":"string"},"description":"The message IDs to modify together in one call, up to 1000. Prefer this over message_id whenever there is more than one message."},"message_id":{"type":"string","description":"A single message ID, for the one-message case only. Provide either this or message_ids."},"thread_id":{"type":"string","description":"A thread ID, to label or unlabel every message in that conversation in one call, as Gmail does when a conversation is selected. Provide this instead of message_id or message_ids."},"add_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to add, e.g. [\"Label_12\"]"},"remove_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to remove, e.g. [\"INBOX\"] to archive or [\"UNREAD\"] to mark read; combine with add_labels to label and mark read in the same call"}},"required":[]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_label_message'
    AND md5(t.description) = '8d7dd521a9e8b1d172245ab9a998a498'
    AND md5(t.input_schema_json::text) = '91abf6ead60af566ab4e92ca515ab5ed'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_label_message: expected 1 row, updated %', n; END IF;

  -- calendar_list_calendars: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'calendar_list_calendars', 'gws-mcp__calendar_list_calendars',
    'Lists the calendars on the connected account''s calendar list: its own, shared ones it has added, and subscribed ones such as holidays. Returns one compact entry per calendar: its ID, title, whether it is the primary calendar, the account''s access role (owner, writer, reader or freeBusyReader) and its time zone, plus a page token when more remain. The ID is what calendar_list_events and the other calendar tools take as calendar_id.',
    '{"type":"object","properties":{"max_results":{"type":"number","description":"The most calendars to return in one page (default: 50, at most 250)."},"page_token":{"type":"string","description":"The nextPageToken from an earlier call, to read the page after it."}},"required":[]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__calendar_list_calendars');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_list_calendars: expected 1 row, inserted %', n; END IF;

  -- calendar_respond_to_event: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'calendar_respond_to_event', 'gws-mcp__calendar_respond_to_event',
    'Answers an invitation on the connected account''s calendar: accepted, declined or tentative, with an optional note to the organizer. Takes the event ID and the response. The account has to be on the event''s guest list; an event it is not invited to is refused with a message saying so. Returns the event ID, its title, the response now recorded and the note. With send_updates left at its default the organizer is told, as when a person answers in Google Calendar.',
    '{"type":"object","properties":{"event_id":{"type":"string","description":"The ID of the event to answer, as calendar_list_events and calendar_get_event return it."},"response":{"type":"string","enum":["accepted","declined","tentative"],"description":"The answer to record: accepted, declined or tentative."},"comment":{"type":"string","description":"An optional note to the organizer, shown beside the answer."},"calendar_id":{"type":"string","description":"Calendar ID (default: \"primary\")"},"send_updates":{"type":"string","enum":["all","externalOnly","none"],"description":"Who to send response notifications to (default: \"all\")"}},"required":["event_id","response"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__calendar_respond_to_event');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_respond_to_event: expected 1 row, inserted %', n; END IF;

  -- calendar_suggest_time: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'calendar_suggest_time', 'gws-mcp__calendar_suggest_time',
    'Suggests meeting times when everyone named is free. Takes the attendees'' addresses, a duration and a time range, and reads their free/busy along with the connected account''s own. Returns candidate start and end times inside working hours, in order of time, each as an ISO time and as a local time in the time zone used. Working hours default to 9 to 17 in the account''s primary calendar time zone, and weekends are skipped unless include_weekends is true. Starts fall on the quarter hour. An attendee whose free/busy cannot be read (another organization that does not share it, or a misspelled address) is listed under could_not_check, and the suggestions then leave that person out. The range can span at most 31 days. Nothing is booked; calendar_create_event books a chosen slot.',
    '{"type":"object","properties":{"attendees":{"type":"string","description":"Comma-separated email addresses of the people to find a time for."},"duration_minutes":{"type":"number","description":"How long the meeting is, in minutes (5 to 480)."},"time_min":{"type":"string","description":"Start of the range to search (ISO 8601)."},"time_max":{"type":"string","description":"End of the range to search (ISO 8601), at most 31 days after time_min."},"time_zone":{"type":"string","description":"The IANA time zone working hours are read in, such as \"Europe/London\" (default: the primary calendar''s time zone)."},"working_hours_start":{"type":"number","description":"The hour the working day starts, 0 to 23 (default: 9)."},"working_hours_end":{"type":"number","description":"The hour the working day ends, 1 to 24 (default: 17)."},"include_weekends":{"type":"boolean","description":"Whether Saturdays and Sundays can be suggested (default: false)."},"include_self":{"type":"boolean","description":"Whether the connected account''s own calendar counts as busy time (default: true)."},"max_suggestions":{"type":"number","description":"The most slots to return (default: 5, at most 20)."}},"required":["attendees","duration_minutes","time_min","time_max"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__calendar_suggest_time');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward calendar_suggest_time: expected 1 row, inserted %', n; END IF;

  -- drive_get_file_permissions: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'drive_get_file_permissions', 'gws-mcp__drive_get_file_permissions',
    'Lists who has access to a Google Drive file or folder and at what role. Takes the file ID. Returns one entry per permission: its ID, its type (user, group, domain or anyone), the role (owner, organizer, fileOrganizer, writer, commenter or reader), and the person''s name and address or the domain where there is one. A file the account cannot see answers as not found.',
    '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID."}},"required":["file_id"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__drive_get_file_permissions');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_get_file_permissions: expected 1 row, inserted %', n; END IF;

  -- drive_list_recent_files: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'drive_list_recent_files', 'gws-mcp__drive_list_recent_files',
    'Lists the Google Drive files the account opened most recently, or the ones modified most recently, the most recent at the top. Returns one compact entry per file: its ID, name, MIME type, when it was last modified, when the account last opened it, and its link, plus a page token when more remain. Files in Trash are left out.',
    '{"type":"object","properties":{"by":{"type":"string","enum":["opened","modified"],"description":"Order by when the account last opened each file, or by when each file was last modified by anyone (default: opened)."},"page_size":{"type":"number","description":"The most files to return in one page (default: 20, at most 100)."},"page_token":{"type":"string","description":"The nextPageToken from an earlier call, to read the page after it."}},"required":[]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__drive_list_recent_files');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_list_recent_files: expected 1 row, inserted %', n; END IF;

  -- drive_share_file: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'drive_share_file', 'gws-mcp__drive_share_file',
    'Shares a Google Drive file or folder with one person by email address, as reader, commenter or writer. Takes the file ID, the address and the role, and optionally a message for the notification email. Google emails the person unless notify is false. Returns the file ID and its permission list afterwards: who has access, at what role. Sharing a file with someone already on it at another role adds no second entry; Drive keeps one per person. This gives the person access to the file and, for a folder, to what is inside it.',
    '{"type":"object","properties":{"file_id":{"type":"string","description":"The Google Drive file or folder ID to share."},"email":{"type":"string","description":"The email address of the person to share with."},"role":{"type":"string","enum":["reader","commenter","writer"],"description":"The access to give: reader (view), commenter (view and comment) or writer (edit)."},"message":{"type":"string","description":"An optional message, sent in the notification email."},"notify":{"type":"boolean","description":"Whether Google emails the person about the share (default: true)."}},"required":["file_id","email","role"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__drive_share_file');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward drive_share_file: expected 1 row, inserted %', n; END IF;

  -- gmail_mark_spam: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_mark_spam', 'gws-mcp__gmail_mark_spam',
    'Reports one Gmail message as spam. Takes the message ID. The message gets Gmail''s SPAM label and leaves the inbox, as the Report spam button does, and Gmail deletes spam for good after 30 days; gmail_unmark_spam moves it back before then. Returns the message ID, whether it is now in spam, and the labels it carries afterwards. Acts on the one message named, not on the rest of its thread.',
    '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to report as spam."}},"required":["message_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_mark_spam');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_mark_spam: expected 1 row, inserted %', n; END IF;

  -- gmail_trash_thread: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_trash_thread', 'gws-mcp__gmail_trash_thread',
    'Moves a whole Gmail conversation to Trash: every message in the thread, in one call. Takes the thread ID. The messages leave the inbox and every other label view and stay in Trash, where Gmail deletes them for good after 30 days; gmail_untrash_thread restores them before then. Returns the thread ID and, for each message in it, the message ID and whether it is now in Trash.',
    '{"type":"object","properties":{"thread_id":{"type":"string","description":"The ID of the thread to move to Trash, as gmail_search, gmail_list and gmail_read return it (threadId)."}},"required":["thread_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_trash_thread');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_trash_thread: expected 1 row, inserted %', n; END IF;

  -- gmail_unmark_spam: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_unmark_spam', 'gws-mcp__gmail_unmark_spam',
    'Moves one Gmail message out of spam and back to the inbox, as the Not spam button does. Takes the message ID. Returns the message ID, whether it is still in spam, and the labels it carries afterwards.',
    '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to move out of spam."}},"required":["message_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_unmark_spam');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_unmark_spam: expected 1 row, inserted %', n; END IF;

  -- gmail_untrash_thread: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'gmail_untrash_thread', 'gws-mcp__gmail_untrash_thread',
    'Takes a whole Gmail conversation out of Trash: every message in the thread, in one call. Takes the thread ID. Returns the thread ID and, for each message in it, the message ID and whether it is still in Trash. Messages Gmail has already deleted from Trash are gone and are not in the answer.',
    '{"type":"object","properties":{"thread_id":{"type":"string","description":"The ID of the thread to take out of Trash."}},"required":["thread_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'gws-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'gws-mcp__gmail_untrash_thread');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_untrash_thread: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('calendar_list_calendars', 'calendar_respond_to_event', 'calendar_suggest_time', 'drive_get_file_permissions', 'drive_list_recent_files', 'drive_share_file', 'gmail_label_message', 'gmail_mark_spam', 'gmail_trash_thread', 'gmail_unmark_spam', 'gmail_untrash_thread');
COMMIT;
