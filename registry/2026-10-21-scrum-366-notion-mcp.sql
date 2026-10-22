-- Registry change for notion-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway 1a76498ce92b0d42c5c376e0bd3788e8f2c9f6c1 (what is running) and aeead2c7fa5468f9ed42ae384ff595b2b303eeb3.
-- A NEW plugin, by --new-plugin: the tool file kept for 1a76498ce92b0d42c5c376e0bd3788e8f2c9f6c1 is not read, whatever it holds.
-- Its mcp_servers row is inserted first, from plugins/notion-mcp/datatorag.json and package.json at aeead2c7fa5468f9ed42ae384ff595b2b303eeb3:
--   name, description, the manifest as manifest_json, the license, a source link in this repository,
--   status active, and container_port the lowest port from 40000 that no mcp_servers row holds,
--   chosen by the statement itself. It raises if a row for notion-mcp already exists.
-- 0 row(s) change, 18 added, 0 removed.
-- Rows for notion-mcp: 0 before, 18 after.
--   adds notion_create_comment
--   adds notion_create_database
--   adds notion_create_page
--   adds notion_create_view
--   adds notion_delete_comment
--   adds notion_duplicate_page
--   adds notion_get_comments
--   adds notion_get_database
--   adds notion_get_page
--   adds notion_list_users
--   adds notion_move_page
--   adds notion_query_data_source
--   adds notion_search
--   adds notion_update_comment
--   adds notion_update_data_source
--   adds notion_update_page
--   adds notion_update_page_content
--   adds notion_update_view
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
  -- notion-mcp: a new plugin, its server row
  INSERT INTO mcp_servers (slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json, status, container_port)
  SELECT 'notion-mcp', 'Notion',
    'Notion: search, pages as markdown, databases and their rows, comments, and people',
    'https://github.com/datatorag/mcp-gateway/tree/main/plugins/notion-mcp', 'datatorag', 'mcp-gateway',
    NULL,
    '{"name":"Notion","description":"Notion: search, pages as markdown, databases and their rows, comments, and people","oauth":{"provider":"notion","authorizeUrl":"https://api.notion.com/v1/oauth/authorize","tokenUrl":"https://api.notion.com/v1/oauth/token","clientIdEnv":"$NOTION_OAUTH_CLIENT_ID","clientSecretEnv":"$NOTION_OAUTH_CLIENT_SECRET","scopes":[],"owner":"user"}}'::jsonb,
    'active',
    (SELECT min(p.port) FROM generate_series(40000, 40999) AS p(port) WHERE NOT EXISTS (SELECT 1 FROM mcp_servers o WHERE o.container_port = p.port))
  WHERE NOT EXISTS (SELECT 1 FROM mcp_servers s WHERE s.slug = 'notion-mcp');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers notion-mcp: expected 1 row, inserted %', n; END IF;
  SELECT count(*) INTO n FROM mcp_servers s JOIN mcp_servers o ON o.container_port = s.container_port WHERE s.slug = 'notion-mcp';
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers notion-mcp: expected 1 row on its port, found %', n; END IF;

  -- notion_create_comment: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_create_comment', 'notion-mcp__notion_create_comment',
    'Adds a comment to a Notion page, to a block, or as a reply in an existing discussion. Takes exactly one of page_id, block_id and discussion_id, and the text as plain text. A new comment on a selection of text is not possible through Notion''s API; a reply to an existing one is, by its discussion_id. Returns the comment''s id, discussion_id, created_time, created_by, text and parent.',
    '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"block_id":{"type":"string","description":"The block''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"discussion_id":{"type":"string","description":"The discussion to reply in, from notion_get_comments."},"text":{"type":"string","description":"The comment as plain text. Over 2,000 characters is split into several text pieces."}},"required":["text"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_create_comment');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_comment: expected 1 row, inserted %', n; END IF;

  -- notion_create_database: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_create_database', 'notion-mcp__notion_create_database',
    'Creates a Notion database under a page, with one data source and that data source''s property schema. The schema is a map of property name to type, for example {"Task": "title", "Due": "date", "Stage": {"type": "status", "options": ["Todo", "Done"]}}. A map with no title property gets one named Name. Returns the database''s id, title, url, parent, is_inline and data_sources (their ids are what notion_create_page and notion_query_data_source take).',
    '{"type":"object","properties":{"parent_page_id":{"type":"string","description":"The page the database is created in: its Notion id or URL."},"title":{"type":"string","description":"The database''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"description":{"type":"string","description":"The database''s description as plain text."},"is_inline":{"type":"boolean","description":"true shows the database inside the parent page''s content; false (the default) makes it a full-page database."},"properties":{"type":"object","description":"Property name to type. A type is a name (title, rich_text, number, select, multi_select, status, date, people, files, checkbox, url, email, phone_number, created_time, created_by, last_edited_time, last_edited_by, place, verification, unique_id) or an object with settings: {\"type\": \"select\", \"options\": [\"A\", {\"name\": \"B\", \"color\": \"red\"}]}, {\"type\": \"number\", \"format\": \"dollar\"}, {\"type\": \"formula\", \"expression\": \"...\"}, {\"type\": \"relation\", \"data_source_id\": \"...\", \"dual\": true}, {\"type\": \"unique_id\", \"prefix\": \"T\"}. Any type also takes \"description\", and \"config\" with Notion''s own settings object (the form a rollup takes)."}},"required":["parent_page_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_create_database');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_database: expected 1 row, inserted %', n; END IF;

  -- notion_create_page: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_create_page', 'notion-mcp__notion_create_page',
    'Creates one Notion page: under a page, or as a row of a data source. Takes the parent, a title, property values as plain values (for a row), content as markdown, and an optional template. For a row, the data source schema is read once and each value is encoded against it. Returns the new page''s id, url, title, parent and properties. A failed create is not sent again; a create that got no answer may still have happened, and notion_search by title shows whether it did. Content and a template are not taken together.',
    '{"type":"object","properties":{"parent_page_id":{"type":"string","description":"The parent page''s Notion id or URL. Exactly one of parent_page_id and parent_data_source_id is set."},"parent_data_source_id":{"type":"string","description":"The parent data source''s Notion id (notion_get_database lists a database''s data sources). The page becomes a row of it. Exactly one of parent_page_id and parent_data_source_id is set."},"title":{"type":"string","description":"The page''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"properties":{"type":"object","description":"Property values as plain values keyed by property name, the shape notion_get_page returns: {\"Status\": \"Done\", \"Tags\": [\"Docs\"], \"Due\": \"2026-10-30\", \"Estimate\": 3, \"Owner\": [\"<user id>\"], \"Done\": true}. Values are checked against the data source schema before the write: an unknown name, a wrong value type or a select or status option that does not exist is refused in words, with the names the schema has. People and relations take ids; files take links; null clears a value. Formula, rollup, created and edited times, and unique ids are set by Notion and refused."},"content":{"type":"string","description":"The page content as Notion''s enhanced markdown, with headings, lists, tables, code and to-dos. Absent creates an empty page."},"template":{"type":"string","description":"\"default\" for the data source''s default template, or a template page''s id or URL. Notion fills in the template''s content and properties in the background after the call returns."},"allow_async":{"type":"boolean","description":"With content, true lets Notion accept a large page and build it in the background; the result is then a task id, not the page."}}}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_create_page');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_page: expected 1 row, inserted %', n; END IF;

  -- notion_create_view: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_create_view', 'notion-mcp__notion_create_view',
    'Adds a view to a Notion database: a table, board, list, calendar, timeline, gallery, form, chart, map or dashboard over one of its data sources, with an optional filter, sorts and layout configuration in Notion''s JSON. Returns the view''s id, name, type, database_id, data_source_id, url, filter and sorts. The view id is what notion_query_data_source takes as view_id.',
    '{"type":"object","properties":{"database_id":{"type":"string","description":"The database''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"data_source_id":{"type":"string","description":"The data source the view shows''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"name":{"type":"string","description":"The view''s name, shown on its tab."},"type":{"type":"string","enum":["table","board","list","calendar","timeline","gallery","form","chart","map","dashboard"],"description":"The view''s layout, one of the listed types."},"filter":{"type":"object","description":"A Notion filter object, sent unchanged, in the form notion_query_data_source takes."},"sorts":{"type":"array","items":{"type":"object"},"description":"A list of Notion sort objects, sent unchanged."},"configuration":{"type":"object","description":"Notion''s view configuration object, sent unchanged; its type matches the view''s type (for example a board''s group_by)."}},"required":["database_id","data_source_id","name","type"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_create_view');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_view: expected 1 row, inserted %', n; END IF;

  -- notion_delete_comment: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_delete_comment', 'notion-mcp__notion_delete_comment',
    'Deletes one Notion comment. Notion''s API deletes only comments created through the same connection, and answers not found for any other. Returns the comment id and deleted true.',
    '{"type":"object","properties":{"comment_id":{"type":"string","description":"The comment''s id, from notion_get_comments or notion_create_comment."}},"required":["comment_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_delete_comment');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_delete_comment: expected 1 row, inserted %', n; END IF;

  -- notion_duplicate_page: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_duplicate_page', 'notion-mcp__notion_duplicate_page',
    'Copies one Notion page under a parent page or into a data source, by reading the source page and creating a new one; Notion''s API has no duplicate. The copy carries the title, the content as markdown, the icon and cover when they are an emoji or a link, and, in a data source, the property values the target schema accepts. Comments, page history, page-level permissions, files stored in Notion, and blocks with no markdown form are not carried by a duplicate; content is copied as Notion''s markdown rendering, so some block formatting can differ. Returns the new page''s id and url, properties_not_copied with the reason for each, unknown_block_ids (blocks that could not be copied) and content_truncated.',
    '{"type":"object","properties":{"page_id":{"type":"string","description":"The page to copy''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"parent_page_id":{"type":"string","description":"The parent page''s Notion id or URL. Exactly one of parent_page_id and parent_data_source_id is set."},"parent_data_source_id":{"type":"string","description":"The parent data source''s Notion id (notion_get_database lists a database''s data sources). The page becomes a row of it. Exactly one of parent_page_id and parent_data_source_id is set."},"title":{"type":"string","description":"The copy''s title. Absent keeps the source page''s title."}},"required":["page_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_duplicate_page');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_duplicate_page: expected 1 row, inserted %', n; END IF;

  -- notion_get_comments: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_get_comments', 'notion-mcp__notion_get_comments',
    'Reads the open comments on one Notion page or block. Each comment is reduced to id, discussion_id (comments in one thread share it), created_time, created_by (a name, or an id when Notion gives no name), text and parent. Resolved comments are not returned by Notion''s API. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them.',
    '{"type":"object","properties":{"block_id":{"type":"string","description":"The page or block''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 50. A full page comes back with has_more true and a next_cursor for the rest."}},"required":["block_id"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_get_comments');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_get_comments: expected 1 row, inserted %', n; END IF;

  -- notion_get_database: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_get_database', 'notion-mcp__notion_get_database',
    'Reads one Notion database and the schema of each of its data sources. In Notion''s current API a database is a container of one or more data sources, and rows and properties live on the data source; most databases have one. Returns the database''s id, title, url, parent and in_trash, and data_sources: for each, its id, name and properties as a list of {name, type}, with options (the option names) for select, multi_select and status properties. The data source id is the one notion_query_data_source takes.',
    '{"type":"object","properties":{"database_id":{"type":"string","description":"The database''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."}},"required":["database_id"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_get_database');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_get_database: expected 1 row, inserted %', n; END IF;

  -- notion_get_page: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_get_page', 'notion-mcp__notion_get_page',
    'Reads one Notion page: its title, url, parent, timestamps and properties, and its content as markdown. Properties come back as plain values keyed by property name, for example {"Status": "Done", "Assignee": ["Test User"], "Due": "2026-10-20"}. A database row is a page, so a row''s id returns that row. The markdown is Notion''s own rendering; truncated is true when Notion cut it short (very long pages), and unknown_block_ids lists blocks with no markdown form, such as embeds and link previews. A page that is not shared with the DataToRAG connection reads as not found.',
    '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"include_markdown":{"type":"boolean","description":"Whether to fetch the page content as markdown, which is a second request. Default true. False returns the properties alone, which is enough to read a database row''s values."}},"required":["page_id"]}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_get_page');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_get_page: expected 1 row, inserted %', n; END IF;

  -- notion_list_users: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_list_users', 'notion-mcp__notion_list_users',
    'Lists the people and bots in the Notion workspace, or reads one of them. Each user is reduced to id, type (person or bot), name, and email for a person when Notion includes it; a bot also carries workspace_name. With user_id set to "me", returns the DataToRAG connection''s own bot user, whose workspace_name names the workspace this connection is in. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them. A single user comes back in the same shape, as a one-item results list.',
    '{"type":"object","properties":{"user_id":{"type":"string","description":"A Notion user id, with or without dashes, or \"me\" for the connection''s own bot user. Absent lists the workspace."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 50. A full page comes back with has_more true and a next_cursor for the rest."}}}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_list_users');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_list_users: expected 1 row, inserted %', n; END IF;

  -- notion_move_page: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_move_page', 'notion-mcp__notion_move_page',
    'Moves one Notion page to a new parent: another page, or a data source (where it becomes a row). Pages only; Notion''s API does not move databases or other blocks. Returns the page''s id, url and new parent.',
    '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"parent_page_id":{"type":"string","description":"The parent page''s Notion id or URL. Exactly one of parent_page_id and parent_data_source_id is set."},"parent_data_source_id":{"type":"string","description":"The parent data source''s Notion id (notion_get_database lists a database''s data sources). The page becomes a row of it. Exactly one of parent_page_id and parent_data_source_id is set."}},"required":["page_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_move_page');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_move_page: expected 1 row, inserted %', n; END IF;

  -- notion_query_data_source: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_query_data_source', 'notion-mcp__notion_query_data_source',
    'Reads the rows of one Notion data source (a table inside a database), with an optional filter, sort order, property allowlist, page size and cursor. Each row is {id, url, created_time, last_edited_time, properties}, with properties as plain values keyed by property name. Filter and sorts are passed to Notion as written, in Notion''s query JSON; notion_get_database lists the property names and types they refer to. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them. With view_id in place of data_source_id, the rows are a saved view''s, in its own filter and sort order, and each row is its id alone, which is what Notion''s view query returns; notion_get_page reads a row''s properties. A view query''s results stay cached for 15 minutes; total_count is the number of rows it matched, and incomplete true means Notion''s 10,000-row cache cut them short.',
    '{"type":"object","properties":{"data_source_id":{"type":"string","description":"The data source''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"view_id":{"type":"string","description":"A database view''s id, or a database URL whose ?v= names the view. Takes the place of data_source_id; filter, sorts and properties are not taken with it."},"filter":{"type":"object","description":"A Notion filter object, sent unchanged. Example: {\"property\": \"Status\", \"status\": {\"equals\": \"Done\"}}; compound filters use {\"and\": [...]} or {\"or\": [...]}. Notion''s filter reference documents the condition each property type takes. Absent returns every row."},"sorts":{"type":"array","items":{"type":"object"},"description":"A list of Notion sort objects, sent unchanged, applied in order. Example: [{\"property\": \"Due\", \"direction\": \"ascending\"}] or [{\"timestamp\": \"last_edited_time\", \"direction\": \"descending\"}]."},"properties":{"type":"array","items":{"type":"string"},"description":"Property names to keep in each row. Absent keeps every property. Names that a row does not have are left out of that row."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 25. A full page comes back with has_more true and a next_cursor for the rest."}}}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_query_data_source');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_query_data_source: expected 1 row, inserted %', n; END IF;

  -- notion_search: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_search', 'notion-mcp__notion_search',
    'Searches the Notion pages and data sources shared with the DataToRAG connection, by title. Notion''s search matches titles, not page content, and Notion describes its index as not immediate and not guaranteed complete, so a page created moments ago can be missing. Takes an optional query, an optional object type, a page size and a cursor. Each result is reduced to id, object (page or data_source), title, url, parent ({type, id}) and last_edited_time. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them. A page or database that exists but is not shared with the connection does not appear.',
    '{"type":"object","properties":{"query":{"type":"string","description":"Text matched against titles. Absent or empty returns every shared page and data source, most recently edited at the top."},"object":{"type":"string","enum":["page","data_source"],"description":"Limits results to pages or to data sources (the tables inside a database). Absent returns both."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 20. A full page comes back with has_more true and a next_cursor for the rest."}}}'::jsonb,
    true
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_search');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_search: expected 1 row, inserted %', n; END IF;

  -- notion_update_comment: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_update_comment', 'notion-mcp__notion_update_comment',
    'Replaces the text of one Notion comment. Notion''s API edits only comments created through the same connection, and answers not found for any other. Returns the comment.',
    '{"type":"object","properties":{"comment_id":{"type":"string","description":"The comment''s id, from notion_get_comments or notion_create_comment."},"text":{"type":"string","description":"The new text, as plain text. Over 2,000 characters is split into several text pieces."}},"required":["comment_id","text"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_update_comment');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_comment: expected 1 row, inserted %', n; END IF;

  -- notion_update_data_source: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_update_data_source', 'notion-mcp__notion_update_data_source',
    'Changes one Notion data source (the table inside a database): its title, its property schema, or whether it is in the trash. The schema change is a map keyed by a property''s current name: null removes the property for every row, {"name": "New"} renames it, and a type (alone or with name) changes its type and settings, in the forms notion_create_database takes. A select''s options list replaces the whole list. Changing a type can leave existing values unreadable in the new type. Returns the data source''s id, title, in_trash and property schema.',
    '{"type":"object","properties":{"data_source_id":{"type":"string","description":"The data source''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"title":{"type":"string","description":"The data source''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"properties":{"type":"object","description":"Property changes keyed by current name: null removes, {\"name\": \"...\"} renames, a type or {\"type\": ..., settings} changes the type."},"in_trash":{"type":"boolean","description":"true moves the data source to the trash; false restores it."}},"required":["data_source_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_update_data_source');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_data_source: expected 1 row, inserted %', n; END IF;

  -- notion_update_page: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_update_page', 'notion-mcp__notion_update_page',
    'Changes one Notion page''s title, property values, icon or cover, applies a template, or moves it to or from the trash. Property values are plain values checked against the page''s data source schema (one read of the page and one of its schema). in_trash true is how a page is deleted through Notion''s API, and in_trash false restores it. Omitted properties keep their values; a list value replaces the whole list. Returns the page''s id, url, title, parent, in_trash and properties.',
    '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"title":{"type":"string","description":"The page''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"properties":{"type":"object","description":"Property values as plain values keyed by property name, the shape notion_get_page returns: {\"Status\": \"Done\", \"Tags\": [\"Docs\"], \"Due\": \"2026-10-30\", \"Estimate\": 3, \"Owner\": [\"<user id>\"], \"Done\": true}. Values are checked against the data source schema before the write: an unknown name, a wrong value type or a select or status option that does not exist is refused in words, with the names the schema has. People and relations take ids; files take links; null clears a value. Formula, rollup, created and edited times, and unique ids are set by Notion and refused."},"icon":{"type":["string","null"],"description":"An emoji, or an image URL. null removes the icon."},"cover":{"type":["string","null"],"description":"A cover image URL. null removes the cover."},"in_trash":{"type":"boolean","description":"true moves the page to the trash (the delete); false restores it from the trash."},"template":{"type":"string","description":"\"default\" for the data source''s default template, or a template page''s id or URL. Notion fills in the template''s content and properties in the background after the call returns."}},"required":["page_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_update_page');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_page: expected 1 row, inserted %', n; END IF;

  -- notion_update_page_content: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_update_page_content', 'notion-mcp__notion_update_page_content',
    'Edits one Notion page''s content as markdown, in one of three modes. edits replaces exact passages, each {old_str, new_str, replace_all_matches}; an edit whose old_str matches nothing is listed in warnings while the others apply. replace_with replaces the whole content. insert adds markdown at the start, at the end (the default), or after a selection. Child pages and databases are kept unless allow_deleting_content is true, and Notion refuses an edit that would remove them. The content of a synced page is not edited through Notion''s API. Returns the page id and Notion''s warnings.',
    '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"edits":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"old_str":{"type":"string","description":"Text in the page''s markdown, matched exactly. Not empty."},"new_str":{"type":"string","description":"The text that replaces old_str. Empty deletes the passage."},"replace_all_matches":{"type":"boolean","description":"true replaces every match. Default false, where an old_str with several matches is refused by Notion."}},"required":["old_str","new_str"]},"description":"Passage replacements, at most 100, applied in one request. notion_get_page shows the markdown they match against."},"replace_with":{"type":"string","description":"Markdown that replaces the page''s whole content."},"insert":{"type":"string","description":"Markdown to add to the page, placed by position or after."},"position":{"type":"string","enum":["start","end"],"description":"With insert: start or end of the page. Default end."},"after":{"type":"string","description":"With insert: a selection of existing content to insert after, written \"start text...end text\"."},"allow_deleting_content":{"type":"boolean","description":"With edits or replace_with: true lets the change remove child pages and databases. Sent to Notion only when set."},"allow_async":{"type":"boolean","description":"true lets Notion apply a large change in the background; the result is then a task id and carries no warnings."}},"required":["page_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_update_page_content');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_page_content: expected 1 row, inserted %', n; END IF;

  -- notion_update_view: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint)
  SELECT s.id, 'notion_update_view', 'notion-mcp__notion_update_view',
    'Changes one Notion database view''s name, filter, sorts or layout configuration. null clears the filter or the sorts; omitted fields keep their values. A view''s type is not changed through Notion''s API. Returns the view in the shape notion_create_view returns.',
    '{"type":"object","properties":{"view_id":{"type":"string","description":"The view''s id, or a database URL whose ?v= names the view."},"name":{"type":"string","description":"The view''s new name, shown on its tab."},"filter":{"type":["object","null"],"description":"A Notion filter object, sent unchanged. null clears the filter."},"sorts":{"type":["array","null"],"items":{"type":"object"},"description":"A list of Notion property sort objects, sent unchanged. null clears the sorts."},"configuration":{"type":"object","description":"Notion''s view configuration object, sent unchanged."}},"required":["view_id"]}'::jsonb,
    false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_update_view');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_view: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'notion-mcp';
  IF n <> 18 THEN RAISE EXCEPTION 'rows for notion-mcp: expected 18, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'notion-mcp' AND t.name IN ('notion_create_comment', 'notion_create_database', 'notion_create_page', 'notion_create_view', 'notion_delete_comment', 'notion_duplicate_page', 'notion_get_comments', 'notion_get_database', 'notion_get_page', 'notion_list_users', 'notion_move_page', 'notion_query_data_source', 'notion_search', 'notion_update_comment', 'notion_update_data_source', 'notion_update_page', 'notion_update_page_content', 'notion_update_view');
COMMIT;
