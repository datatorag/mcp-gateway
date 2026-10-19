-- Registry change for atlassian-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway c85ae9f95dffae95df6c615eec1ee0ebc9eb1484 (what is running) and 2fcff3a2c4dab7cb6930bc0b1c9c58b6b58006ae.
-- 2 row(s) change, 4 added, 0 removed.
-- Rows for atlassian-mcp: 24 before, 28 after.
--   changes confluence_add_comment: description, input_schema_json
--   changes confluence_get_comments: description
--   adds jira_add_worklog
--   adds jira_link_issues
--   adds jira_list_issue_links
--   adds jira_list_worklogs
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
  UPDATE tools t SET description = 'Add a comment to a Confluence page: a footer comment on the page, an inline comment anchored to a piece of the page''s text with inline_text, or a reply to an existing footer or inline comment with parent_comment_id. A reply goes into the same kind of thread as the comment it answers. An inline_text that does not appear in the page is refused before anything is posted; when it appears more than once, inline_match picks which. Returns the new comment''s ID, version, type and parent.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The ID of the page to comment on."},"body":{"type":"string","description":"Comment text (plain text; will be wrapped in <p> tags automatically)."},"parent_comment_id":{"type":"string","description":"Optional ID of an existing comment, footer or inline, to reply to."},"inline_text":{"type":"string","description":"Optional text on the page to anchor an inline comment to, exactly as it reads on the page. Not used with parent_comment_id."},"inline_match":{"type":"number","description":"Which occurrence of inline_text to anchor to, counting from 1, when it appears more than once (default 1)."}},"required":["page_id","body"]}'::jsonb, read_only_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'confluence_add_comment'
    AND md5(t.description) = '763fbe9948478c03313d6de3b3b95d03'
    AND md5(t.input_schema_json::text) = 'ca0508560efd51595c2cdd53f04d9072'
    AND t.read_only_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward confluence_add_comment: expected 1 row, updated %', n; END IF;

  -- confluence_get_comments
  UPDATE tools t SET description = 'Get all comments on a Confluence page, footer and inline, with their replies, including their body content and version info. Each comment carries its type (footer or inline) and parent_id, the comment it replies to, or null for a comment on the page itself. An inline comment also carries the page text it is anchored to and whether it is open or resolved.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The ID of the page whose comments to retrieve."}},"required":["page_id"]}'::jsonb, read_only_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'atlassian-mcp' AND t.name = 'confluence_get_comments'
    AND md5(t.description) = 'db1efd97c5d1a3271299df4b2fc0b3fa'
    AND md5(t.input_schema_json::text) = '3f64dd05b37e241774095f5232c53946'
    AND t.read_only_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward confluence_get_comments: expected 1 row, updated %', n; END IF;

  -- jira_add_worklog: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'jira_add_worklog', 'atlassian-mcp__jira_add_worklog',
    'Log time spent on a Jira issue. Takes the issue key, the time in Jira''s duration format ("1h 30m", "2d", "45m"), and optionally when the work started and a comment. Returns the worklog Jira stored: its ID, author, time spent in Jira''s words and in seconds, start time and comment. Jira adjusts the issue''s remaining estimate as it does for time logged in its own interface. A time that is not a Jira duration is refused before anything is sent.',
    '{"type":"object","properties":{"issue_key":{"type":"string","description":"The issue key (e.g. PROJ-123)"},"time_spent":{"type":"string","description":"Time spent, in Jira''s duration format: weeks, days, hours and minutes, e.g. \"1h 30m\", \"2d\", \"45m\""},"started":{"type":"string","description":"When the work started, as an ISO date and time (e.g. 2026-10-19T09:00:00Z). Defaults to now"},"comment":{"type":"string","description":"A comment on the worklog (plain text, will be converted to ADF)"}},"required":["issue_key","time_spent"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'atlassian-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'atlassian-mcp__jira_add_worklog');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward jira_add_worklog: expected 1 row, inserted %', n; END IF;

  -- jira_link_issues: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'jira_link_issues', 'atlassian-mcp__jira_link_issues',
    'Link two Jira issues, such as one blocking another or one duplicating another. Takes the two issue keys and a link type, by its name ("Blocks") or by the phrase it reads with from the first issue ("blocks", "is blocked by", "relates to"), so issue_key blocks other_issue_key, or is blocked by it. The link types a site has are listed by jira_list_issue_links. An unknown type is refused with the site''s types listed, and nothing is sent. Returns the new link and every link of the first issue afterwards, as Jira reports them.',
    '{"type":"object","properties":{"issue_key":{"type":"string","description":"The issue the link phrase is said of (e.g. PROJ-123 in \"PROJ-123 blocks PROJ-124\")"},"other_issue_key":{"type":"string","description":"The other issue (e.g. PROJ-124)"},"link_type":{"type":"string","description":"The link type''s name, or the phrase that reads from issue_key to other_issue_key (e.g. \"blocks\", \"is blocked by\", \"relates to\", \"duplicates\")"},"comment":{"type":"string","description":"A comment added with the link (plain text, will be converted to ADF)"}},"required":["issue_key","other_issue_key","link_type"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'atlassian-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'atlassian-mcp__jira_link_issues');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward jira_link_issues: expected 1 row, inserted %', n; END IF;

  -- jira_list_issue_links: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'jira_list_issue_links', 'atlassian-mcp__jira_list_issue_links',
    'List the links of a Jira issue: for each, its ID, type, the phrase that reads from this issue to the other one ("blocks", "is blocked by"), and the other issue''s key, summary and status. Also returns the link types the site has, each with its name and its two phrases, which are what jira_link_issues takes.',
    '{"type":"object","properties":{"issue_key":{"type":"string","description":"The issue key (e.g. PROJ-123)"}},"required":["issue_key"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'atlassian-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'atlassian-mcp__jira_list_issue_links');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward jira_list_issue_links: expected 1 row, inserted %', n; END IF;

  -- jira_list_worklogs: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'jira_list_worklogs', 'atlassian-mcp__jira_list_worklogs',
    'List the time logged on a Jira issue. Returns each worklog''s ID, author, time spent in Jira''s words and in seconds, start time and comment as plain text, with the number of worklogs and the total time in seconds.',
    '{"type":"object","properties":{"issue_key":{"type":"string","description":"The issue key (e.g. PROJ-123)"},"max_results":{"type":"number","description":"Maximum number of worklogs to return (default 100)"}},"required":["issue_key"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'atlassian-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'atlassian-mcp__jira_list_worklogs');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward jira_list_worklogs: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'atlassian-mcp';
  IF n <> 28 THEN RAISE EXCEPTION 'rows for atlassian-mcp: expected 28, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'atlassian-mcp' AND t.name IN ('confluence_add_comment', 'confluence_get_comments', 'jira_add_worklog', 'jira_link_issues', 'jira_list_issue_links', 'jira_list_worklogs');
COMMIT;
