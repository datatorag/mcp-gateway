-- ROLLBACK of the registry change for slack-mcp. PROPOSAL: NOT RUN.
-- Returns the registry to no row for slack-mcp, from what 2c430114043d8a7b05b490786d64e755b85a8cab served.
-- A NEW plugin: the rollback deletes its tool rows and then its mcp_servers row, which is
-- guarded by the md5 of every column the forward file wrote except the port it chose, and
-- refuses while any tool, env var or plugin connection row still points at it, so the
-- foreign keys' cascade can never remove one.
-- 0 row(s) change, 10 added, 0 removed.
-- Rows for slack-mcp: 0 before, 10 after.
--   deletes slack_channel_history
--   deletes slack_channels_list
--   deletes slack_dm_send
--   deletes slack_files_list
--   deletes slack_message_post
--   deletes slack_message_update
--   deletes slack_messages_search
--   deletes slack_reactions_add
--   deletes slack_thread_read
--   deletes slack_users_lookup
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
  -- slack_channel_history: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_channel_history'
    AND md5(t.description) = 'fa64e89dfe79cdc2316064b09af89cd5'
    AND md5(t.input_schema_json::text) = '51228feb2ebe69131c4c58e53578f79f';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_channel_history: expected 1 row, deleted %', n; END IF;

  -- slack_channels_list: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_channels_list'
    AND md5(t.description) = 'af401e28cf06ff73c41c04156b9b2b31'
    AND md5(t.input_schema_json::text) = '7649eb7aae3424da67648e7e2ef4a1bc';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_channels_list: expected 1 row, deleted %', n; END IF;

  -- slack_dm_send: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_dm_send'
    AND md5(t.description) = 'c7914a9c6e0b138cebaf18ca365245ae'
    AND md5(t.input_schema_json::text) = '7dd68db35106ccb337163ca9549a7684';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_dm_send: expected 1 row, deleted %', n; END IF;

  -- slack_files_list: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_files_list'
    AND md5(t.description) = 'a5d5ea5dd56674875b73e625c6f00eae'
    AND md5(t.input_schema_json::text) = 'bad939481f2f4be76271d55dae322a25';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_files_list: expected 1 row, deleted %', n; END IF;

  -- slack_message_post: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_message_post'
    AND md5(t.description) = 'eaacc9c515bf416357c39e4762fa7318'
    AND md5(t.input_schema_json::text) = '69bf4d5de763a9f34e4a1131a6110f64';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_message_post: expected 1 row, deleted %', n; END IF;

  -- slack_message_update: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_message_update'
    AND md5(t.description) = '74d398cfe8889a4c156acd9fcecdf788'
    AND md5(t.input_schema_json::text) = '22fd8d08560c867f375907533a8bdb60';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_message_update: expected 1 row, deleted %', n; END IF;

  -- slack_messages_search: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_messages_search'
    AND md5(t.description) = 'f4a2bac548693b9d6e188693d5ee121c'
    AND md5(t.input_schema_json::text) = '60da67bd2685737524177f599e5eb774';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_messages_search: expected 1 row, deleted %', n; END IF;

  -- slack_reactions_add: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_reactions_add'
    AND md5(t.description) = '69f9b410c00913512aed76131a98d648'
    AND md5(t.input_schema_json::text) = 'c6d60510331fea25f137f22f283c5f44';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_reactions_add: expected 1 row, deleted %', n; END IF;

  -- slack_thread_read: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_thread_read'
    AND md5(t.description) = 'd700e8eda885dfa7fa6448038596724e'
    AND md5(t.input_schema_json::text) = 'ab2ccf6ef469a91dc6ee3a2d964ea226';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_thread_read: expected 1 row, deleted %', n; END IF;

  -- slack_users_lookup: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'slack-mcp' AND t.name = 'slack_users_lookup'
    AND md5(t.description) = '426f9af9ac2abbb4c1a40de20c4eff5e'
    AND md5(t.input_schema_json::text) = '46fbf0b546e824912238b8ebf570f1e5';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback slack_users_lookup: expected 1 row, deleted %', n; END IF;

  -- slack-mcp: the new plugin's server row goes
  DELETE FROM mcp_servers s
  WHERE s.slug = 'slack-mcp'
    AND md5(jsonb_build_array(s.name, s.description, s.github_repo_url, s.github_repo_owner, s.github_repo_name, s.license_spdx, s.manifest_json, s.status)::text) = '1c35d6cb6664f644f78ecd0e07f4609c'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM mcp_server_env_vars e WHERE e.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM plugin_connections c WHERE c.mcp_server_id = s.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback mcp_servers slack-mcp: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'slack-mcp';
  IF n <> 0 THEN RAISE EXCEPTION 'rows for slack-mcp: expected 0, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'slack-mcp' AND t.name IN ('slack_channel_history', 'slack_channels_list', 'slack_dm_send', 'slack_files_list', 'slack_message_post', 'slack_message_update', 'slack_messages_search', 'slack_reactions_add', 'slack_thread_read', 'slack_users_lookup');
COMMIT;
