-- ROLLBACK of the registry change for brevo-mcp. PROPOSAL: NOT RUN.
-- Returns the registry to no row for brevo-mcp, from what 2c430114043d8a7b05b490786d64e755b85a8cab served.
-- A NEW plugin: the rollback deletes its tool rows and then its mcp_servers row, which is
-- guarded by the md5 of every column the forward file wrote except the port it chose, and
-- refuses while any tool, env var or plugin connection row still points at it, so the
-- foreign keys' cascade can never remove one.
-- 0 row(s) change, 20 added, 0 removed.
-- Rows for brevo-mcp: 0 before, 20 after.
--   deletes account_get
--   deletes campaign_create
--   deletes campaign_export_recipients
--   deletes campaign_get
--   deletes campaign_send
--   deletes campaign_send_test
--   deletes campaign_set_status
--   deletes campaign_update
--   deletes campaigns_list
--   deletes contact_create
--   deletes contact_get
--   deletes contact_update
--   deletes contacts_search
--   deletes email_log
--   deletes email_send
--   deletes email_stats
--   deletes list_members_update
--   deletes lists_get
--   deletes process_get
--   deletes templates_get
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
  -- account_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'account_get'
    AND md5(t.description) = '67e3ded6a53366fa718fd525e13b2bf7'
    AND md5(t.input_schema_json::text) = '0db5b87f2be0aa89fab47bf03bb97a58';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback account_get: expected 1 row, deleted %', n; END IF;

  -- campaign_create: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaign_create'
    AND md5(t.description) = 'd3f10759fb1e65f84416d89d7dc57de1'
    AND md5(t.input_schema_json::text) = 'd8f0056ab1ee6150317d3bc2bc571c51';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaign_create: expected 1 row, deleted %', n; END IF;

  -- campaign_export_recipients: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaign_export_recipients'
    AND md5(t.description) = '5528ea40f45a973bd694bfa29cd2c890'
    AND md5(t.input_schema_json::text) = 'fbe76d85d799fb0345de7005f20655c8';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaign_export_recipients: expected 1 row, deleted %', n; END IF;

  -- campaign_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaign_get'
    AND md5(t.description) = '66b629fecd3cfbb814034323ecd4f7f5'
    AND md5(t.input_schema_json::text) = '4f1250fa866f1877a036da95357ae4ff';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaign_get: expected 1 row, deleted %', n; END IF;

  -- campaign_send: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaign_send'
    AND md5(t.description) = '77c51d7af6013f546ec2c88fcc69cdd2'
    AND md5(t.input_schema_json::text) = '98485919927c96661fd49520827c2066';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaign_send: expected 1 row, deleted %', n; END IF;

  -- campaign_send_test: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaign_send_test'
    AND md5(t.description) = 'eadcc1dfef8b97c04d45118c89b47225'
    AND md5(t.input_schema_json::text) = 'ea76f5a5b12c99d08892660eeb9442c2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaign_send_test: expected 1 row, deleted %', n; END IF;

  -- campaign_set_status: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaign_set_status'
    AND md5(t.description) = '39299ede10f874d4c29a3d8d2c6cdf44'
    AND md5(t.input_schema_json::text) = 'ca5c9cffc1d7a2ec763e109047390909';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaign_set_status: expected 1 row, deleted %', n; END IF;

  -- campaign_update: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaign_update'
    AND md5(t.description) = '4c65163e5f302cce3d9d6944882f4f2a'
    AND md5(t.input_schema_json::text) = 'adb38940df817bb91fb866536eaddcb2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaign_update: expected 1 row, deleted %', n; END IF;

  -- campaigns_list: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'campaigns_list'
    AND md5(t.description) = '4d08ff27bd4d97a3996542bc1c84efcf'
    AND md5(t.input_schema_json::text) = 'f3085875613d64a9d8cba2ce1cd2a904';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback campaigns_list: expected 1 row, deleted %', n; END IF;

  -- contact_create: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'contact_create'
    AND md5(t.description) = '47affc0cedc01b6d0a1d7793bd140aaf'
    AND md5(t.input_schema_json::text) = '51a13172eb0bb165536ac4d4c98df545';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback contact_create: expected 1 row, deleted %', n; END IF;

  -- contact_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'contact_get'
    AND md5(t.description) = 'ebfd8ae25325c07c92768512426a9c9a'
    AND md5(t.input_schema_json::text) = '5f0ccceb51794c2802353851256fea87';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback contact_get: expected 1 row, deleted %', n; END IF;

  -- contact_update: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'contact_update'
    AND md5(t.description) = '0afc1e250879ee79a48412f3cfef926b'
    AND md5(t.input_schema_json::text) = '1394a283a2109d427ad9be660151dbdb';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback contact_update: expected 1 row, deleted %', n; END IF;

  -- contacts_search: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'contacts_search'
    AND md5(t.description) = '9165c7f9e31ecdb523c0fa3be9339f54'
    AND md5(t.input_schema_json::text) = 'da30333b0bced96102fe30e6e8abc6e9';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback contacts_search: expected 1 row, deleted %', n; END IF;

  -- email_log: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'email_log'
    AND md5(t.description) = 'cec197e517bee728ab8fac9b7965c987'
    AND md5(t.input_schema_json::text) = '0034d2135862fce0e75e397665383a08';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback email_log: expected 1 row, deleted %', n; END IF;

  -- email_send: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'email_send'
    AND md5(t.description) = '1bc85ab1af53b8c3653d97246f2704d5'
    AND md5(t.input_schema_json::text) = '8ce94fa4dcf077fbd520e7953588d47c';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback email_send: expected 1 row, deleted %', n; END IF;

  -- email_stats: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'email_stats'
    AND md5(t.description) = 'ee8f90dab1e4676590e33456aa714947'
    AND md5(t.input_schema_json::text) = '6e14c0964fa5153baf3165c8d32e1599';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback email_stats: expected 1 row, deleted %', n; END IF;

  -- list_members_update: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'list_members_update'
    AND md5(t.description) = '78873c9f582ab270fdd0bb5a146d6e05'
    AND md5(t.input_schema_json::text) = 'a10950877cfd1c5ee02da501dc9dd932';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback list_members_update: expected 1 row, deleted %', n; END IF;

  -- lists_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'lists_get'
    AND md5(t.description) = '4a0e5f222a988a24bed9e4c7fd15661d'
    AND md5(t.input_schema_json::text) = 'a324101c5c7cc342611422789367225d';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback lists_get: expected 1 row, deleted %', n; END IF;

  -- process_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'process_get'
    AND md5(t.description) = '60185a132efff904ae8d2c9c064565bb'
    AND md5(t.input_schema_json::text) = 'f3e2170a64779f1dcca1d339f640a5de';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback process_get: expected 1 row, deleted %', n; END IF;

  -- templates_get: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'brevo-mcp' AND t.name = 'templates_get'
    AND md5(t.description) = 'ecf0f9468d55bd7ca062ba4c210b7a2a'
    AND md5(t.input_schema_json::text) = '1b3e4cb9bf3df25f98b10b44d4959757';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback templates_get: expected 1 row, deleted %', n; END IF;

  -- brevo-mcp: the new plugin's server row goes
  DELETE FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND md5(jsonb_build_array(s.name, s.description, s.github_repo_url, s.github_repo_owner, s.github_repo_name, s.license_spdx, s.manifest_json, s.status)::text) = '01c74e85e029ed8f44bce685975703df'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM mcp_server_env_vars e WHERE e.mcp_server_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM plugin_connections c WHERE c.mcp_server_id = s.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback mcp_servers brevo-mcp: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'brevo-mcp';
  IF n <> 0 THEN RAISE EXCEPTION 'rows for brevo-mcp: expected 0, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'brevo-mcp' AND t.name IN ('account_get', 'campaign_create', 'campaign_export_recipients', 'campaign_get', 'campaign_send', 'campaign_send_test', 'campaign_set_status', 'campaign_update', 'campaigns_list', 'contact_create', 'contact_get', 'contact_update', 'contacts_search', 'email_log', 'email_send', 'email_stats', 'list_members_update', 'lists_get', 'process_get', 'templates_get');
COMMIT;
