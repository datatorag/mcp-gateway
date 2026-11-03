-- ROLLBACK of the registry change for posthog-mcp. PROPOSAL: NOT RUN.
-- Returns the registry to no row for posthog-mcp, from what 9b5f167b0dfc881a74e5be05b2a641d4543e10b6 served.
-- A NEW plugin: the rollback deletes its tool rows and then its mcp_servers row, which is
-- guarded by the md5 of every column the forward file wrote except the port it chose, and
-- refuses while any tool, env var or plugin connection row still points at it, so the
-- foreign keys' cascade can never remove one.
-- 0 row(s) change, 10 added, 0 removed.
-- Rows for posthog-mcp: 0 before, 10 after.
--   deletes posthog_dashboards_list
--   deletes posthog_error_issues_list
--   deletes posthog_events_list
--   deletes posthog_hogql_query
--   deletes posthog_insight_get
--   deletes posthog_insights_list
--   deletes posthog_persons_search
--   deletes posthog_project_get
--   deletes posthog_trends_query
--   deletes posthog_web_overview
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
  -- posthog_dashboards_list: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_dashboards_list'
    AND md5(t.description) = 'b2f9e1989fff0689be5453985d3f9911'
    AND md5(t.input_schema_json::text) = '0929b8bcb20d71548edf8e8ae423f2c5';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_dashboards_list: expected 1 row, deleted %', n; END IF;

  -- posthog_error_issues_list: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_error_issues_list'
    AND md5(t.description) = 'c1cb25cdd64d78965e64842504ee2c24'
    AND md5(t.input_schema_json::text) = '157feabc7ed6c1bbbd0770f28df09064';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_error_issues_list: expected 1 row, deleted %', n; END IF;

  -- posthog_events_list: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_events_list'
    AND md5(t.description) = '78e0f3d16045871f82eb90914f10a5ee'
    AND md5(t.input_schema_json::text) = '53f551159f48a2efa1df2e85ae307c41';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_events_list: expected 1 row, deleted %', n; END IF;

  -- posthog_hogql_query: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_hogql_query'
    AND md5(t.description) = 'c6f93ba44472f62f34d0096ef381bcf1'
    AND md5(t.input_schema_json::text) = '9f929049bc2857ce08d28c737446803b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_hogql_query: expected 1 row, deleted %', n; END IF;

  -- posthog_insight_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_insight_get'
    AND md5(t.description) = 'a7309120ebf7816bb0b3ead1f9ce34a5'
    AND md5(t.input_schema_json::text) = 'f039477ca2e1541107ae834b1d8c64b4';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_insight_get: expected 1 row, deleted %', n; END IF;

  -- posthog_insights_list: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_insights_list'
    AND md5(t.description) = '66feb831d4c56d9390624693543d2f09'
    AND md5(t.input_schema_json::text) = '1c6610ca2d704b5585e1bc2def36b2cf';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_insights_list: expected 1 row, deleted %', n; END IF;

  -- posthog_persons_search: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_persons_search'
    AND md5(t.description) = '7d9de28a8272316000a2fc7bd7d39634'
    AND md5(t.input_schema_json::text) = 'a0c59654880e83316c8a15fe17b722f1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_persons_search: expected 1 row, deleted %', n; END IF;

  -- posthog_project_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_project_get'
    AND md5(t.description) = 'b4b475463fce40adcda20e12fed22bb3'
    AND md5(t.input_schema_json::text) = '0db5b87f2be0aa89fab47bf03bb97a58';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_project_get: expected 1 row, deleted %', n; END IF;

  -- posthog_trends_query: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_trends_query'
    AND md5(t.description) = '8fea7bb5fff8083315d9155b4f729a49'
    AND md5(t.input_schema_json::text) = 'e098473f26f52fb1c322eaea7b86880a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_trends_query: expected 1 row, deleted %', n; END IF;

  -- posthog_web_overview: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'posthog-mcp' AND t.name = 'posthog_web_overview'
    AND md5(t.description) = 'c4f01cfb3fbd505367fe6125a0dcf9a7'
    AND md5(t.input_schema_json::text) = '9827ed95c9108a11682f872e8f71e706';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback posthog_web_overview: expected 1 row, deleted %', n; END IF;

  -- posthog-mcp: the new plugin's server row goes
  DELETE FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND md5(jsonb_build_array(s.name, s.description, s.github_repo_url, s.github_repo_owner, s.github_repo_name, s.license_spdx, s.manifest_json, s.status)::text) = '155de117034fb9c9694fa5bc26cd002c'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM mcp_server_env_vars e WHERE e.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM plugin_connections c WHERE c.mcp_server_id = s.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback mcp_servers posthog-mcp: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'posthog-mcp';
  IF n <> 0 THEN RAISE EXCEPTION 'rows for posthog-mcp: expected 0, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'posthog-mcp' AND t.name IN ('posthog_dashboards_list', 'posthog_error_issues_list', 'posthog_events_list', 'posthog_hogql_query', 'posthog_insight_get', 'posthog_insights_list', 'posthog_persons_search', 'posthog_project_get', 'posthog_trends_query', 'posthog_web_overview');
COMMIT;
