-- Registry change for posthog-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway 2c430114043d8a7b05b490786d64e755b85a8cab (what is running) and 9b5f167b0dfc881a74e5be05b2a641d4543e10b6.
-- A NEW plugin, by --new-plugin: the tool file kept for 2c430114043d8a7b05b490786d64e755b85a8cab is not read, whatever it holds.
-- Its mcp_servers row is inserted first, from plugins/posthog-mcp/datatorag.json and package.json at 9b5f167b0dfc881a74e5be05b2a641d4543e10b6:
--   name, description, the manifest as manifest_json, the license, a source link in this repository,
--   status active, and container_port the lowest port from 40000 that no mcp_servers row holds,
--   chosen by the statement itself. It raises if a row for posthog-mcp already exists.
-- 0 row(s) change, 10 added, 0 removed.
-- Rows for posthog-mcp: 0 before, 10 after.
--   adds posthog_dashboards_list
--   adds posthog_error_issues_list
--   adds posthog_events_list
--   adds posthog_hogql_query
--   adds posthog_insight_get
--   adds posthog_insights_list
--   adds posthog_persons_search
--   adds posthog_project_get
--   adds posthog_trends_query
--   adds posthog_web_overview
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
  -- posthog-mcp: a new plugin, its server row
  INSERT INTO mcp_servers (slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json, status, container_port)
  SELECT 'posthog-mcp', 'PostHog',
    'PostHog, read-only: one project''s trends, web analytics and HogQL queries, saved insights and dashboards, events, people and error tracking issues',
    'https://github.com/datatorag/mcp-gateway/tree/main/plugins/posthog-mcp', 'datatorag', 'mcp-gateway',
    NULL,
    '{"name":"PostHog","description":"PostHog, read-only: one project''s trends, web analytics and HogQL queries, saved insights and dashboards, events, people and error tracking issues"}'::jsonb,
    'active',
    (SELECT min(p.port) FROM generate_series(40000, 40999) AS p(port) WHERE NOT EXISTS (SELECT 1 FROM mcp_servers o WHERE o.container_port = p.port))
  WHERE NOT EXISTS (SELECT 1 FROM mcp_servers s WHERE s.slug = 'posthog-mcp');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers posthog-mcp: expected 1 row, inserted %', n; END IF;
  SELECT count(*) INTO n FROM mcp_servers s JOIN mcp_servers o ON o.container_port = s.container_port WHERE s.slug = 'posthog-mcp';
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers posthog-mcp: expected 1 row on its port, found %', n; END IF;

  -- posthog_dashboards_list: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_dashboards_list', 'posthog-mcp__posthog_dashboards_list',
    'The project''s dashboards, with a name search: each one''s id, name, description and whether it is pinned.',
    '{"type":"object","properties":{"search":{"type":"string","description":"Part of a dashboard''s name."},"pinned":{"type":"boolean","description":"Only pinned dashboards."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 20."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_dashboards_list');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_dashboards_list: expected 1 row, inserted %', n; END IF;

  -- posthog_error_issues_list: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_error_issues_list', 'posthog-mcp__posthog_error_issues_list',
    'Error tracking issues seen in a date range, ranked: each issue''s id, name, status, occurrences, users, and when it was first and last seen.',
    '{"type":"object","properties":{"date_from":{"type":"string","description":"Start of the range. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"date_to":{"type":"string","description":"End of the range. Default now. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"status":{"type":"string","enum":["active","resolved","suppressed","all"],"description":"Default active."},"order_by":{"type":"string","enum":["occurrences","last_seen","first_seen","users","sessions"],"description":"Default occurrences."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 20."},"filter_test_accounts":{"type":"boolean","description":"Leave out the project''s internal and test traffic, by its own test-account filters. Default true."}},"required":["date_from"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_error_issues_list');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_error_issues_list: expected 1 row, inserted %', n; END IF;

  -- posthog_events_list: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_events_list', 'posthog-mcp__posthog_events_list',
    'Recent events in a date range, newest first: each event''s id, name, time, distinct id and up to 20 of its properties. Filter by event name, a person, or properties equal to values.',
    '{"type":"object","properties":{"date_from":{"type":"string","description":"Start of the range. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"date_to":{"type":"string","description":"End of the range, required so the numbers do not move. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"event":{"type":"string","description":"Only this event name."},"person_id":{"type":"string","description":"Only this person''s events, by the person''s id."},"properties":{"type":"array","maxItems":5,"items":{"type":"object","properties":{"key":{"type":"string"},"value":{"type":["string","number","boolean"]}},"required":["key","value"],"additionalProperties":false},"description":"Only events whose properties equal these, at most five."},"limit":{"type":"integer","minimum":1,"maximum":200,"description":"How many to return, at most 200. Default 50."}},"required":["date_from","date_to"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_events_list');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_events_list: expected 1 row, inserted %', n; END IF;

  -- posthog_hogql_query: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_hogql_query', 'posthog-mcp__posthog_hogql_query',
    'Runs one HogQL SELECT (PostHog''s SQL) in the project and returns its columns and rows. A LIMIT is added when the query has none, and a LIMIT above the cap is lowered. Keep queries narrow: PostHog stops a query after ten seconds. Tables include events, persons and sessions.',
    '{"type":"object","properties":{"query":{"type":"string","description":"One SELECT, or WITH ... SELECT. No semicolons between statements."},"limit":{"type":"integer","minimum":1,"maximum":1000,"description":"How many to return, at most 1000. Default 100."}},"required":["query"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_hogql_query');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_hogql_query: expected 1 row, inserted %', n; END IF;

  -- posthog_insight_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_insight_get', 'posthog-mcp__posthog_insight_get',
    'One saved insight by its id or its short id (the code in its URL): its definition and its last computed result, at most 100 rows. refresh: force_cache (default) reads what PostHog has, blocking recomputes if stale.',
    '{"type":"object","properties":{"insight_id":{"type":"integer","minimum":1,"description":"The insight''s numeric id."},"short_id":{"type":"string","description":"The insight''s short id. Give this or insight_id."},"refresh":{"type":"string","enum":["force_cache","blocking"],"description":"Default force_cache."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_insight_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_insight_get: expected 1 row, inserted %', n; END IF;

  -- posthog_insights_list: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_insights_list', 'posthog-mcp__posthog_insights_list',
    'Saved insights, newest first, with a name search. Their results are not included; posthog_insight_get reads one.',
    '{"type":"object","properties":{"search":{"type":"string","description":"Part of an insight''s name or description."},"saved":{"type":"boolean","description":"Only insights saved by a person. Default true."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 20."},"offset":{"type":"integer","minimum":0,"description":"How many to skip, to page through. Default 0."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_insights_list');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_insights_list: expected 1 row, inserted %', n; END IF;

  -- posthog_persons_search: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_persons_search', 'posthog-mcp__posthog_persons_search',
    'People by part of their email, name or distinct id: each one''s id, up to five distinct ids, when they were first seen, and up to 20 properties.',
    '{"type":"object","properties":{"search":{"type":"string","description":"Part of an email, name or distinct id."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 20."}},"required":["search"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_persons_search');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_persons_search: expected 1 row, inserted %', n; END IF;

  -- posthog_project_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_project_get', 'posthog-mcp__posthog_project_get',
    'The connected PostHog project: its id, name, organization and timezone. Read the timezone before choosing a date range.',
    '{"type":"object","properties":{},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_project_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_project_get: expected 1 row, inserted %', n; END IF;

  -- posthog_trends_query: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_trends_query', 'posthog-mcp__posthog_trends_query',
    'A trend of one to five events over a date range: counts, unique users, or a property''s sum or average, per hour, day, week or month, optionally broken down by one event property (at most 25 values).',
    '{"type":"object","properties":{"series":{"type":"array","minItems":1,"maxItems":5,"description":"The events to count.","items":{"type":"object","properties":{"event":{"type":"string","description":"The event name, e.g. $pageview."},"math":{"type":"string","enum":["total","dau","weekly_active","monthly_active","unique_session","sum","avg","min","max","median","p90","p95","p99"],"description":"How to count. Default total. sum and the rest need math_property."},"math_property":{"type":"string","description":"The event property a sum, average or percentile is over."},"properties":{"type":"array","maxItems":5,"items":{"type":"object","properties":{"key":{"type":"string"},"value":{"type":["string","number","boolean"]}},"required":["key","value"],"additionalProperties":false},"description":"Only events whose properties equal these, at most five."}},"required":["event"],"additionalProperties":false}},"date_from":{"type":"string","description":"Start of the range. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"date_to":{"type":"string","description":"End of the range, required so the numbers do not move. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"interval":{"type":"string","enum":["hour","day","week","month"],"description":"Default day."},"breakdown":{"type":"string","description":"An event property to break the trend down by."},"filter_test_accounts":{"type":"boolean","description":"Leave out the project''s internal and test traffic, by its own test-account filters. Default true."}},"required":["series","date_from","date_to"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_trends_query');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_trends_query: expected 1 row, inserted %', n; END IF;

  -- posthog_web_overview: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'posthog_web_overview', 'posthog-mcp__posthog_web_overview',
    'Web analytics for a date range: visitors, page views, sessions, session duration and bounce rate, optionally against the period before.',
    '{"type":"object","properties":{"date_from":{"type":"string","description":"Start of the range. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"date_to":{"type":"string","description":"End of the range, required so the numbers do not move. A date (2026-11-01), an ISO date and time, or relative to now: -7d, -24h, -2w, -3m, -1y."},"compare":{"type":"boolean","description":"Also give the period before and the change. Default false."},"filter_test_accounts":{"type":"boolean","description":"Leave out the project''s internal and test traffic, by its own test-account filters. Default true."}},"required":["date_from","date_to"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'posthog-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'posthog-mcp__posthog_web_overview');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward posthog_web_overview: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'posthog-mcp';
  IF n <> 10 THEN RAISE EXCEPTION 'rows for posthog-mcp: expected 10, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'posthog-mcp' AND t.name IN ('posthog_dashboards_list', 'posthog_error_issues_list', 'posthog_events_list', 'posthog_hogql_query', 'posthog_insight_get', 'posthog_insights_list', 'posthog_persons_search', 'posthog_project_get', 'posthog_trends_query', 'posthog_web_overview');
COMMIT;
