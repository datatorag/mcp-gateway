-- Registry change for slack-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway cba2a86554a9707df00ba4c2081533c5982fd515 (what is running) and 2c430114043d8a7b05b490786d64e755b85a8cab.
-- A NEW plugin, by --new-plugin: the tool file kept for cba2a86554a9707df00ba4c2081533c5982fd515 is not read, whatever it holds.
-- Its mcp_servers row is inserted first, from plugins/slack-mcp/datatorag.json and package.json at 2c430114043d8a7b05b490786d64e755b85a8cab:
--   name, description, the manifest as manifest_json, the license, a source link in this repository,
--   status active, and container_port the lowest port from 40000 that no mcp_servers row holds,
--   chosen by the statement itself. It raises if a row for slack-mcp already exists.
-- 0 row(s) change, 10 added, 0 removed.
-- Rows for slack-mcp: 0 before, 10 after.
--   adds slack_channel_history
--   adds slack_channels_list
--   adds slack_dm_send
--   adds slack_files_list
--   adds slack_message_post
--   adds slack_message_update
--   adds slack_messages_search
--   adds slack_reactions_add
--   adds slack_thread_read
--   adds slack_users_lookup
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
  -- slack-mcp: a new plugin, its server row
  INSERT INTO mcp_servers (slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json, status, container_port)
  SELECT 'slack-mcp', 'Slack',
    'Slack: channels, message search, channel history and threads, people, files, reactions, and posting as the user',
    'https://github.com/datatorag/mcp-gateway/tree/main/plugins/slack-mcp', 'datatorag', 'mcp-gateway',
    NULL,
    '{"name":"Slack","description":"Slack: channels, message search, channel history and threads, people, files, reactions, and posting as the user","oauth":{"provider":"slack","authorizeUrl":"https://slack.com/oauth/v2/authorize","tokenUrl":"https://slack.com/api/oauth.v2.access","clientIdEnv":"$SLACK_CONNECTOR_CLIENT_ID","clientSecretEnv":"$SLACK_CONNECTOR_CLIENT_SECRET","teamIdEnv":"$SLACK_CONNECTOR_TEAM_ID","scopeParam":"user_scope","scopes":["channels:read","groups:read","im:read","mpim:read","channels:history","groups:history","im:history","mpim:history","search:read","chat:write","reactions:write","im:write","users:read","users:read.email","files:read"],"owner":"user"}}'::jsonb,
    'active',
    (SELECT min(p.port) FROM generate_series(40000, 40999) AS p(port) WHERE NOT EXISTS (SELECT 1 FROM mcp_servers o WHERE o.container_port = p.port))
  WHERE NOT EXISTS (SELECT 1 FROM mcp_servers s WHERE s.slug = 'slack-mcp');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers slack-mcp: expected 1 row, inserted %', n; END IF;
  SELECT count(*) INTO n FROM mcp_servers s JOIN mcp_servers o ON o.container_port = s.container_port WHERE s.slug = 'slack-mcp';
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers slack-mcp: expected 1 row on its port, found %', n; END IF;

  -- slack_channel_history: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_channel_history', 'slack-mcp__slack_channel_history',
    'Reads the recent messages of one Slack channel or direct message, newest at the top, without thread replies (slack_thread_read reads those). Takes the channel, an optional time window, a page size and a cursor, and returns {channel {id, name}, messages, has_more, next_cursor}. Each message is {ts, user, text, thread_ts, reply_count, permalink}, with user as a display name, mentions in text as @name and #name, text over 2,000 characters cut with a marker, and fields Slack did not send left out.',
    '{"type":"object","properties":{"channel":{"type":"string","description":"The channel: its Slack id (for example C0123ABCD) or its name with or without a leading # (for example #general). A name shared by more than one channel is refused with the ids of each."},"oldest":{"type":"string","description":"Only messages after this Slack timestamp (seconds since 1970, for example 1700000000.000000). Absent for no lower bound."},"latest":{"type":"string","description":"Only messages before this Slack timestamp (seconds since 1970, for example 1700000000.000000). Absent for up to now."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many messages one call returns, from 1 to 100. Default 20; a larger value is read as 100."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page after that one. Absent for the start of the list."}},"required":["channel"]}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_channel_history');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_channel_history: expected 1 row, inserted %', n; END IF;

  -- slack_channels_list: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_channels_list', 'slack-mcp__slack_channels_list',
    'Lists the Slack conversations the connected user can see, one page at a time, archived ones left out. Takes optional conversation types, a name filter, a page size and a cursor, and returns {channels, next_cursor}, each channel as {id, name, type, is_archived, member_count, topic}; a direct message carries the other person''s user id in place of a name.',
    '{"type":"object","properties":{"types":{"type":"array","items":{"type":"string","enum":["public","private","im","mpim"]},"description":"Which kinds of conversation to list: public channels, private channels, im (direct messages) and mpim (group direct messages). Default public and private."},"query":{"type":"string","description":"Text a channel''s name contains, compared without case. Applied to each page as Slack returns it, so a page can hold fewer channels than the limit while next_cursor still leads to more."},"limit":{"type":"integer","minimum":1,"maximum":200,"description":"How many conversations one call returns, from 1 to 200. Default 50; a larger value is read as 200."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page after that one. Absent for the start of the list."}}}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_channels_list');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_channels_list: expected 1 row, inserted %', n; END IF;

  -- slack_dm_send: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_dm_send', 'slack-mcp__slack_dm_send',
    'Sends a direct message as the connected user to one person in the Slack workspace. Takes the person as a user id or an email address, the text and expected_user_email; the call is refused and no conversation is opened unless the person''s Slack email equals expected_user_email. Returns {user {id, name, email}, channel, ts}.',
    '{"type":"object","properties":{"user":{"type":"string","description":"The person: a Slack user id (for example U0123ABCD) or the email address on their Slack profile."},"text":{"type":"string","description":"The message, in Slack''s mrkdwn (for example *bold*, _italic_, <@U0123ABCD> to mention a person). Up to 40,000 characters."},"expected_user_email":{"type":"string","description":"The email address of the person this message is meant for. The call is refused and nothing is sent unless the person resolves to a Slack profile with this email (compared without case)."}},"required":["user","text","expected_user_email"]}'::jsonb,
    false, true
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_dm_send');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_dm_send: expected 1 row, inserted %', n; END IF;

  -- slack_files_list: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_files_list', 'slack-mcp__slack_files_list',
    'Lists files shared in Slack, newest at the top, as metadata only: {files, total, page, pages}, each file as {id, name, title, filetype, mimetype, size, created, user, channels, permalink}. The file contents and download links are not returned. Takes an optional channel, an optional user id, optional file types, a page size and a page number.',
    '{"type":"object","properties":{"channel":{"type":"string","description":"The channel: its Slack id (for example C0123ABCD) or its name with or without a leading # (for example #general). A name shared by more than one channel is refused with the ids of each. Absent lists files from every conversation the user can see."},"user":{"type":"string","description":"A Slack user id (for example U0123ABCD); only files that person shared are listed. Absent for anyone."},"types":{"type":"string","description":"Slack''s file type filter, comma separated: all, spaces, snippets, images, gdocs, zips, pdfs. Absent for all."},"count":{"type":"integer","minimum":1,"maximum":100,"description":"How many files one call returns, from 1 to 100. Default 20; a larger value is read as 100."},"page":{"type":"integer","minimum":1,"description":"Which page of files to return, counting from 1. Default 1; pages in the answer is how many there are."}}}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_files_list');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_files_list: expected 1 row, inserted %', n; END IF;

  -- slack_message_post: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_message_post', 'slack-mcp__slack_message_post',
    'Posts a message as the connected user to a Slack channel, or as a reply in a thread when thread_ts is given. Takes the channel, the text, an optional thread_ts and expected_channel_name; the call is refused and nothing is sent unless the channel resolves to that name. Returns {channel {id, name}, ts, thread_ts}.',
    '{"type":"object","properties":{"channel":{"type":"string","description":"The channel: its Slack id (for example C0123ABCD) or its name with or without a leading # (for example #general). A name shared by more than one channel is refused with the ids of each."},"text":{"type":"string","description":"The message, in Slack''s mrkdwn (for example *bold*, _italic_, <@U0123ABCD> to mention a person). Up to 40,000 characters."},"thread_ts":{"type":"string","description":"The ts of a thread''s parent message; the post becomes a reply in that thread. Absent posts to the channel itself."},"expected_channel_name":{"type":"string","description":"The name of the channel this message is meant for, as words, for example #general. The call is refused and nothing is sent unless the channel argument resolves to a channel of this name (compared without # and without case)."}},"required":["channel","text","expected_channel_name"]}'::jsonb,
    false, true
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_message_post');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_message_post: expected 1 row, inserted %', n; END IF;

  -- slack_message_update: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_message_update', 'slack-mcp__slack_message_update',
    'Replaces the text of one Slack message the connected user posted. Takes the channel, the message''s ts, the new text and expected_channel_name; the call is refused and nothing is changed unless the channel resolves to that name. Returns {channel {id, name}, ts}.',
    '{"type":"object","properties":{"channel":{"type":"string","description":"The channel: its Slack id (for example C0123ABCD) or its name with or without a leading # (for example #general). A name shared by more than one channel is refused with the ids of each."},"ts":{"type":"string","description":"The message''s ts, Slack''s message timestamp id, for example 1700000000.000100, as returned in a message''s ts field."},"text":{"type":"string","description":"The new text of the message, which replaces the old text whole, in Slack''s mrkdwn (for example *bold*, _italic_, <@U0123ABCD> to mention a person). Up to 40,000 characters."},"expected_channel_name":{"type":"string","description":"The name of the channel this message is meant for, as words, for example #general. The call is refused and nothing is sent unless the channel argument resolves to a channel of this name (compared without # and without case)."}},"required":["channel","ts","text","expected_channel_name"]}'::jsonb,
    false, true
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_message_update');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_message_update: expected 1 row, inserted %', n; END IF;

  -- slack_messages_search: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_messages_search', 'slack-mcp__slack_messages_search',
    'Searches the Slack messages the connected user can see, with Slack''s search syntax (for example in:#general from:@name after:2026-01-01). Takes the query, an optional sort, a page size and a page number, and returns {matches, total, page, pages}, each match as {ts, channel {id, name}, user, text, permalink}.',
    '{"type":"object","properties":{"query":{"type":"string","description":"The search text, with Slack''s modifiers such as in:#channel, from:@person, before: and after: dates, and quoted phrases."},"sort":{"type":"string","enum":["score","timestamp"],"description":"Order of the matches: score (best match at the top, the default) or timestamp (newest at the top)."},"count":{"type":"integer","minimum":1,"maximum":50,"description":"How many matches one call returns, from 1 to 50. Default 20; a larger value is read as 50."},"page":{"type":"integer","minimum":1,"description":"Which page of matches to return, counting from 1. Default 1; pages in the answer is how many there are."}},"required":["query"]}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_messages_search');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_messages_search: expected 1 row, inserted %', n; END IF;

  -- slack_reactions_add: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_reactions_add', 'slack-mcp__slack_reactions_add',
    'Adds an emoji reaction, as the connected user, to one Slack message. Takes the channel, the message''s ts and the emoji name, and returns {channel {id, name}, ts, name, added}, with added false and already_reacted true when the user had already reacted with that emoji.',
    '{"type":"object","properties":{"channel":{"type":"string","description":"The channel: its Slack id (for example C0123ABCD) or its name with or without a leading # (for example #general). A name shared by more than one channel is refused with the ids of each."},"ts":{"type":"string","description":"The message''s ts, Slack''s message timestamp id, for example 1700000000.000100, as returned in a message''s ts field."},"name":{"type":"string","description":"The emoji''s name, with or without colons, for example thumbsup or :eyes:. A custom emoji is named as the workspace names it."}},"required":["channel","ts","name"]}'::jsonb,
    false, false
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_reactions_add');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_reactions_add: expected 1 row, inserted %', n; END IF;

  -- slack_thread_read: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_thread_read', 'slack-mcp__slack_thread_read',
    'Reads one Slack message and the replies in its thread, the parent message at the top and the replies oldest to newest. Takes the channel, the parent message''s ts, a page size and a cursor, and returns {channel {id, name}, messages, has_more, next_cursor}. Each message is {ts, user, text, thread_ts, reply_count, permalink}, with user as a display name, mentions in text as @name and #name, text over 2,000 characters cut with a marker, and fields Slack did not send left out.',
    '{"type":"object","properties":{"channel":{"type":"string","description":"The channel: its Slack id (for example C0123ABCD) or its name with or without a leading # (for example #general). A name shared by more than one channel is refused with the ids of each."},"ts":{"type":"string","description":"The thread''s parent message''s ts, Slack''s message timestamp id, for example 1700000000.000100, as returned in a message''s ts field."},"limit":{"type":"integer","minimum":1,"maximum":200,"description":"How many messages one call returns, from 1 to 200. Default 50; a larger value is read as 200."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page after that one. Absent for the start of the list."}},"required":["channel","ts"]}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_thread_read');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_thread_read: expected 1 row, inserted %', n; END IF;

  -- slack_users_lookup: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'slack_users_lookup', 'slack-mcp__slack_users_lookup',
    'Finds one person in the Slack workspace by email address or by user id; exactly one of the two is taken. Returns {id, name, real_name, handle, email, title, tz, is_bot, deleted}, with name as the display name.',
    '{"type":"object","properties":{"email":{"type":"string","description":"The person''s email address as their Slack profile holds it. Taken in place of user_id."},"user_id":{"type":"string","description":"The person''s Slack user id, for example U0123ABCD. Taken in place of email."}}}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'slack-mcp__slack_users_lookup');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slack_users_lookup: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'slack-mcp';
  IF n <> 10 THEN RAISE EXCEPTION 'rows for slack-mcp: expected 10, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'slack-mcp' AND t.name IN ('slack_channel_history', 'slack_channels_list', 'slack_dm_send', 'slack_files_list', 'slack_message_post', 'slack_message_update', 'slack_messages_search', 'slack_reactions_add', 'slack_thread_read', 'slack_users_lookup');
COMMIT;
