-- ROLLBACK of the registry change for notion-mcp. PROPOSAL: NOT RUN.
-- Returns the registry to no row for notion-mcp, from what aeead2c7fa5468f9ed42ae384ff595b2b303eeb3 served.
-- A NEW plugin: the rollback deletes its tool rows and then its mcp_servers row, which is
-- guarded by the md5 of every column the forward file wrote except the port it chose, and
-- refuses while any tool, env var or plugin connection row still points at it, so the
-- foreign keys' cascade can never remove one.
-- 0 row(s) change, 18 added, 0 removed.
-- Rows for notion-mcp: 0 before, 18 after.
--   deletes notion_create_comment
--   deletes notion_create_database
--   deletes notion_create_page
--   deletes notion_create_view
--   deletes notion_delete_comment
--   deletes notion_duplicate_page
--   deletes notion_get_comments
--   deletes notion_get_database
--   deletes notion_get_page
--   deletes notion_list_users
--   deletes notion_move_page
--   deletes notion_query_data_source
--   deletes notion_search
--   deletes notion_update_comment
--   deletes notion_update_data_source
--   deletes notion_update_page
--   deletes notion_update_page_content
--   deletes notion_update_view
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
  -- notion_create_comment: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_comment'
    AND md5(t.description) = '5b733459f4b49aeadcf32e60e115e97e'
    AND md5(t.input_schema_json::text) = '01e9773dd07b87ac0046e0e01b2ccb39';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_create_comment: expected 1 row, deleted %', n; END IF;

  -- notion_create_database: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_database'
    AND md5(t.description) = '61e0793598facbbf553dee6be8390083'
    AND md5(t.input_schema_json::text) = '1de14ff56751939b45c529a921e2c913';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_create_database: expected 1 row, deleted %', n; END IF;

  -- notion_create_page: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_page'
    AND md5(t.description) = 'b795b654e02a418e5c24f542b514a329'
    AND md5(t.input_schema_json::text) = '23b145bb113006c8018dda24be06da20';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_create_page: expected 1 row, deleted %', n; END IF;

  -- notion_create_view: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_view'
    AND md5(t.description) = 'c3874090b1056ac6e057ab7dc26600ae'
    AND md5(t.input_schema_json::text) = '09469d141763829ebb7ecf8b5279131f';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_create_view: expected 1 row, deleted %', n; END IF;

  -- notion_delete_comment: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_delete_comment'
    AND md5(t.description) = 'b7d49c6daab72b3f15184aa884d8ce46'
    AND md5(t.input_schema_json::text) = 'c578768253cd8ea08b25713170da6842';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_delete_comment: expected 1 row, deleted %', n; END IF;

  -- notion_duplicate_page: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_duplicate_page'
    AND md5(t.description) = '41857cec90f5b3b130cb40c5f546ad9c'
    AND md5(t.input_schema_json::text) = 'b0888fc269e8d40c0e7064b402461c82';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_duplicate_page: expected 1 row, deleted %', n; END IF;

  -- notion_get_comments: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_get_comments'
    AND md5(t.description) = 'f74e43eecbe69685955f4f8470f5206b'
    AND md5(t.input_schema_json::text) = '9b5dbc0e0287fd3f9f3e06789180cb63';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_get_comments: expected 1 row, deleted %', n; END IF;

  -- notion_get_database: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_get_database'
    AND md5(t.description) = '123ea23b1dd81932088741d3f7502439'
    AND md5(t.input_schema_json::text) = 'a5ecb6dc18e69e4add300f1e4331c3ad';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_get_database: expected 1 row, deleted %', n; END IF;

  -- notion_get_page: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_get_page'
    AND md5(t.description) = '933264016ebec633f12472402e296e5f'
    AND md5(t.input_schema_json::text) = 'd89914a399f1316724c8e35bab5a6f4e';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_get_page: expected 1 row, deleted %', n; END IF;

  -- notion_list_users: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_list_users'
    AND md5(t.description) = '22f9f52044a7f5108865fa4fdfac4328'
    AND md5(t.input_schema_json::text) = 'fe87d59ab503a317c996cf7d4ee5ba7b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_list_users: expected 1 row, deleted %', n; END IF;

  -- notion_move_page: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_move_page'
    AND md5(t.description) = 'c03625344aeb505297de380a10558a2e'
    AND md5(t.input_schema_json::text) = 'bc72e0af722a43cfa1fe3774ce446ba3';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_move_page: expected 1 row, deleted %', n; END IF;

  -- notion_query_data_source: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_query_data_source'
    AND md5(t.description) = '116c0aa955cc6a1982c372a5cfbf0cda'
    AND md5(t.input_schema_json::text) = '1c212524a7966181c243fce3d7507cd7';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_query_data_source: expected 1 row, deleted %', n; END IF;

  -- notion_search: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_search'
    AND md5(t.description) = 'ff84d00b0edc5bc3f843faf03031697c'
    AND md5(t.input_schema_json::text) = '22620786e7a3e99149f7ac2e0c31d512';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_search: expected 1 row, deleted %', n; END IF;

  -- notion_update_comment: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_comment'
    AND md5(t.description) = '1a13b5b758635326d5ecac715b4494e9'
    AND md5(t.input_schema_json::text) = 'e0619beadf5b0b6f97e61369747601ba';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_update_comment: expected 1 row, deleted %', n; END IF;

  -- notion_update_data_source: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_data_source'
    AND md5(t.description) = 'feea0b5d1bdb4b42c38e0dd8c4f145d3'
    AND md5(t.input_schema_json::text) = '2fcea0e05b63fbfc8dca05691348ccb9';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_update_data_source: expected 1 row, deleted %', n; END IF;

  -- notion_update_page: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_page'
    AND md5(t.description) = '0bee3af4c59b25e7e2e82e406d189b32'
    AND md5(t.input_schema_json::text) = 'a2efe507f1a3529c604d7743c688ed7e';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_update_page: expected 1 row, deleted %', n; END IF;

  -- notion_update_page_content: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_page_content'
    AND md5(t.description) = 'a10643ebfa632ad139cc83019c0f391c'
    AND md5(t.input_schema_json::text) = '713dfe3911b38c7ddaa828c738835f03';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_update_page_content: expected 1 row, deleted %', n; END IF;

  -- notion_update_view: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_view'
    AND md5(t.description) = '1e1ec151797d18979f4e508a01821696'
    AND md5(t.input_schema_json::text) = 'f56fcb4879281aaeecd106fccda3401a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback notion_update_view: expected 1 row, deleted %', n; END IF;

  -- notion-mcp: the new plugin's server row goes
  DELETE FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND md5(jsonb_build_array(s.name, s.description, s.github_repo_url, s.github_repo_owner, s.github_repo_name, s.license_spdx, s.manifest_json, s.status)::text) = '1778453464edd4bdcec30d9da352d0e1'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM mcp_server_env_vars e WHERE e.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM plugin_connections c WHERE c.mcp_server_id = s.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback mcp_servers notion-mcp: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'notion-mcp';
  IF n <> 0 THEN RAISE EXCEPTION 'rows for notion-mcp: expected 0, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'notion-mcp' AND t.name IN ('notion_create_comment', 'notion_create_database', 'notion_create_page', 'notion_create_view', 'notion_delete_comment', 'notion_duplicate_page', 'notion_get_comments', 'notion_get_database', 'notion_get_page', 'notion_list_users', 'notion_move_page', 'notion_query_data_source', 'notion_search', 'notion_update_comment', 'notion_update_data_source', 'notion_update_page', 'notion_update_page_content', 'notion_update_view');
COMMIT;
