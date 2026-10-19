-- ROLLBACK of the registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway c85ae9f95dffae95df6c615eec1ee0ebc9eb1484 served, from what f9ac5f77635a505d839e14eb5b8c1b3683210d3c served.
-- 1 row(s) change, 10 added, 0 removed.
-- Rows for gws-mcp: 77 before, 87 after.
--   restores gmail_label_message: description, input_schema_json
--   deletes calendar_list_calendars
--   deletes calendar_respond_to_event
--   deletes calendar_suggest_time
--   deletes drive_get_file_permissions
--   deletes drive_list_recent_files
--   deletes drive_share_file
--   deletes gmail_mark_spam
--   deletes gmail_trash_thread
--   deletes gmail_unmark_spam
--   deletes gmail_untrash_thread
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
  -- gmail_label_message
  UPDATE tools t SET description = 'Label many messages in ONE call: pass message_ids (up to 1000) with add_labels and/or remove_labels, and every message is modified by a single users.messages.batchModify request. Do not call this once per message. The label-and-mark-read pair is one call: add_labels: ["<label id>"], remove_labels: ["UNREAD"]. Removing INBOX archives; removing UNREAD marks read. Label IDs come from gmail_list_labels. Returns a per-message outcome (results[]: id, ok, error) so a partial batch is visible; if the batch request is refused, each id is retried on its own and reported. message_id is for a single message only.', input_schema_json = '{"type":"object","properties":{"message_ids":{"type":"array","items":{"type":"string"},"description":"The message IDs to modify together in one call, up to 1000. Prefer this over message_id whenever there is more than one message."},"message_id":{"type":"string","description":"A single message ID, for the one-message case only. Provide either this or message_ids."},"add_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to add, e.g. [\"Label_12\"]"},"remove_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to remove, e.g. [\"INBOX\"] to archive or [\"UNREAD\"] to mark read; combine with add_labels to label and mark read in the same call"}},"required":[]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_label_message'
    AND md5(t.description) = '5880627ea7a45a04dd1519ca939fc5a4'
    AND md5(t.input_schema_json::text) = '90268bfd63be487abef2868f7d796fc7'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_label_message: expected 1 row, updated %', n; END IF;

  -- calendar_list_calendars: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_list_calendars'
    AND md5(t.description) = '048b0acd07c761e72c1cfe9dc0835cbc'
    AND md5(t.input_schema_json::text) = 'a55f87438be0bd2233ced77bc577bdcd';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback calendar_list_calendars: expected 1 row, deleted %', n; END IF;

  -- calendar_respond_to_event: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_respond_to_event'
    AND md5(t.description) = '6047371c3daff30343fbcb284b55f58d'
    AND md5(t.input_schema_json::text) = '6e32ef5ae6f5d2a87004e23c89df7ed4';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback calendar_respond_to_event: expected 1 row, deleted %', n; END IF;

  -- calendar_suggest_time: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'calendar_suggest_time'
    AND md5(t.description) = '280e3e230256d3f66e8348bde9f6b6bc'
    AND md5(t.input_schema_json::text) = 'ac50f53c51ac48a732988bc345803460';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback calendar_suggest_time: expected 1 row, deleted %', n; END IF;

  -- drive_get_file_permissions: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_get_file_permissions'
    AND md5(t.description) = 'afcd82f9c69f342cdb067b14bf3cf0f7'
    AND md5(t.input_schema_json::text) = '60832199ecb1d5432e61d8b6c99d5f62';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_get_file_permissions: expected 1 row, deleted %', n; END IF;

  -- drive_list_recent_files: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_list_recent_files'
    AND md5(t.description) = '82622a5e7dc07cab567b17249403040d'
    AND md5(t.input_schema_json::text) = '245e869d9d83c8d96d21ed35f8c95c23';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_list_recent_files: expected 1 row, deleted %', n; END IF;

  -- drive_share_file: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'drive_share_file'
    AND md5(t.description) = 'f1c76cef2524b1cbff483d6536d8432f'
    AND md5(t.input_schema_json::text) = 'cb6658df1ebbff5de06a9b93ef6794e2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback drive_share_file: expected 1 row, deleted %', n; END IF;

  -- gmail_mark_spam: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_mark_spam'
    AND md5(t.description) = '95ac4083b96b568b0dd1bb9e63d57d99'
    AND md5(t.input_schema_json::text) = '688dc10910428a819928a9a0f982da8d';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_mark_spam: expected 1 row, deleted %', n; END IF;

  -- gmail_trash_thread: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_trash_thread'
    AND md5(t.description) = '103a79e2faf1f9e60a1d668c49e994d7'
    AND md5(t.input_schema_json::text) = '3cfd96984c481cda1145e49284164139';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_trash_thread: expected 1 row, deleted %', n; END IF;

  -- gmail_unmark_spam: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_unmark_spam'
    AND md5(t.description) = '4d70d3a1d31d81944d548f856c17a754'
    AND md5(t.input_schema_json::text) = '8521957539965429dc79fcef4a2cb026';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_unmark_spam: expected 1 row, deleted %', n; END IF;

  -- gmail_untrash_thread: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_untrash_thread'
    AND md5(t.description) = 'ffeda09f3ce1f8d58cd71fe46d00d28c'
    AND md5(t.input_schema_json::text) = '635931ace70c7223bfb8f5093599d7de';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback gmail_untrash_thread: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 77 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 77, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('calendar_list_calendars', 'calendar_respond_to_event', 'calendar_suggest_time', 'drive_get_file_permissions', 'drive_list_recent_files', 'drive_share_file', 'gmail_label_message', 'gmail_mark_spam', 'gmail_trash_thread', 'gmail_unmark_spam', 'gmail_untrash_thread');
COMMIT;
