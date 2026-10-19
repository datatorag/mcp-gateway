-- ROLLBACK of the registry change for atlassian-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway c85ae9f95dffae95df6c615eec1ee0ebc9eb1484 served, from what 2fcff3a2c4dab7cb6930bc0b1c9c58b6b58006ae served.
-- 2 row(s) change, 4 added, 0 removed.
-- Rows for atlassian-mcp: 24 before, 28 after.
--   restores confluence_add_comment: description, input_schema_json
--   restores confluence_get_comments: description
--   deletes jira_add_worklog
--   deletes jira_link_issues
--   deletes jira_list_issue_links
--   deletes jira_list_worklogs
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
  -- confluence_add_comment
  UPDATE tools t SET description = 'Add a comment to a Confluence page. Optionally reply to an existing comment by providing parent_comment_id.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The ID of the page to comment on."},"body":{"type":"string","description":"Comment text (plain text; will be wrapped in <p> tags automatically)."},"parent_comment_id":{"type":"string","description":"Optional ID of an existing comment to reply to."}},"required":["page_id","body"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'confluence_add_comment'
    AND md5(t.description) = 'f88db8e7e4b2ebde6b5c9630b3ed1f42'
    AND md5(t.input_schema_json::text) = '773b4f72304dc92271d5737ab888156e'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback confluence_add_comment: expected 1 row, updated %', n; END IF;

  -- confluence_get_comments
  UPDATE tools t SET description = 'Get all comments on a Confluence page, including their body content and version info.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The ID of the page whose comments to retrieve."}},"required":["page_id"]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'confluence_get_comments'
    AND md5(t.description) = 'c60502a4a10a0a60dc81003e2ec7328b'
    AND md5(t.input_schema_json::text) = '3f64dd05b37e241774095f5232c53946'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback confluence_get_comments: expected 1 row, updated %', n; END IF;

  -- jira_add_worklog: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'jira_add_worklog'
    AND md5(t.description) = '8dc212d76b18534ce607714d87bc71a7'
    AND md5(t.input_schema_json::text) = 'a7e04255cd394aa9a8a756c500f94bf2';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback jira_add_worklog: expected 1 row, deleted %', n; END IF;

  -- jira_link_issues: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'jira_link_issues'
    AND md5(t.description) = 'c31547d080146561498654f5ded3c7a7'
    AND md5(t.input_schema_json::text) = '997b93329286c2bda02eed91cbf739ee';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback jira_link_issues: expected 1 row, deleted %', n; END IF;

  -- jira_list_issue_links: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'jira_list_issue_links'
    AND md5(t.description) = 'a6a3dcf077280d47411df5fc47450394'
    AND md5(t.input_schema_json::text) = 'a40e45f875a93b2686647326fba923fc';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback jira_list_issue_links: expected 1 row, deleted %', n; END IF;

  -- jira_list_worklogs: the row goes
  DELETE FROM tools t USING mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'jira_list_worklogs'
    AND md5(t.description) = '11b03049eeb710235beee22262642228'
    AND md5(t.input_schema_json::text) = '6941faff7d34aa5d560f3bb3d3ff8ec4';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback jira_list_worklogs: expected 1 row, deleted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'atlassian-mcp';
  IF n <> 24 THEN RAISE EXCEPTION 'rows for atlassian-mcp: expected 24, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'atlassian-mcp' AND t.name IN ('confluence_add_comment', 'confluence_get_comments', 'jira_add_worklog', 'jira_link_issues', 'jira_list_issue_links', 'jira_list_worklogs');
COMMIT;
