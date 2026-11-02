-- Registry change for notion-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway cba2a86554a9707df00ba4c2081533c5982fd515 (what is running) and 2c430114043d8a7b05b490786d64e755b85a8cab.
-- 18 row(s) change, 0 added, 0 removed.
-- Rows for notion-mcp: 18 before, 18 after.
--   changes notion_create_comment: destructive_hint
--   changes notion_create_database: destructive_hint
--   changes notion_create_page: destructive_hint
--   changes notion_create_view: destructive_hint
--   changes notion_delete_comment: destructive_hint
--   changes notion_duplicate_page: destructive_hint
--   changes notion_get_comments: destructive_hint
--   changes notion_get_database: destructive_hint
--   changes notion_get_page: destructive_hint
--   changes notion_list_users: destructive_hint
--   changes notion_move_page: destructive_hint
--   changes notion_query_data_source: destructive_hint
--   changes notion_search: destructive_hint
--   changes notion_update_comment: destructive_hint
--   changes notion_update_data_source: destructive_hint
--   changes notion_update_page: destructive_hint
--   changes notion_update_page_content: destructive_hint
--   changes notion_update_view: destructive_hint
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
  -- notion_create_comment
  UPDATE tools t SET description = 'Adds a comment to a Notion page, to a block, or as a reply in an existing discussion. Takes exactly one of page_id, block_id and discussion_id, and the text as plain text. A new comment on a selection of text is not possible through Notion''s API; a reply to an existing one is, by its discussion_id. Returns the comment''s id, discussion_id, created_time, created_by, text and parent.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"block_id":{"type":"string","description":"The block''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"discussion_id":{"type":"string","description":"The discussion to reply in, from notion_get_comments."},"text":{"type":"string","description":"The comment as plain text. Over 2,000 characters is split into several text pieces."}},"required":["text"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_comment'
    AND md5(t.description) = '5b733459f4b49aeadcf32e60e115e97e'
    AND md5(t.input_schema_json::text) = '01e9773dd07b87ac0046e0e01b2ccb39'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_comment: expected 1 row, updated %', n; END IF;

  -- notion_create_database
  UPDATE tools t SET description = 'Creates a Notion database under a page, with one data source and that data source''s property schema. The schema is a map of property name to type, for example {"Task": "title", "Due": "date", "Stage": {"type": "status", "options": ["Todo", "Done"]}}. A map with no title property gets one named Name. Returns the database''s id, title, url, parent, is_inline and data_sources (their ids are what notion_create_page and notion_query_data_source take).', input_schema_json = '{"type":"object","properties":{"parent_page_id":{"type":"string","description":"The page the database is created in: its Notion id or URL."},"title":{"type":"string","description":"The database''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"description":{"type":"string","description":"The database''s description as plain text."},"is_inline":{"type":"boolean","description":"true shows the database inside the parent page''s content; false (the default) makes it a full-page database."},"properties":{"type":"object","description":"Property name to type. A type is a name (title, rich_text, number, select, multi_select, status, date, people, files, checkbox, url, email, phone_number, created_time, created_by, last_edited_time, last_edited_by, place, verification, unique_id) or an object with settings: {\"type\": \"select\", \"options\": [\"A\", {\"name\": \"B\", \"color\": \"red\"}]}, {\"type\": \"number\", \"format\": \"dollar\"}, {\"type\": \"formula\", \"expression\": \"...\"}, {\"type\": \"relation\", \"data_source_id\": \"...\", \"dual\": true}, {\"type\": \"unique_id\", \"prefix\": \"T\"}. Any type also takes \"description\", and \"config\" with Notion''s own settings object (the form a rollup takes)."}},"required":["parent_page_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_database'
    AND md5(t.description) = '61e0793598facbbf553dee6be8390083'
    AND md5(t.input_schema_json::text) = '1de14ff56751939b45c529a921e2c913'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_database: expected 1 row, updated %', n; END IF;

  -- notion_create_page
  UPDATE tools t SET description = 'Creates one Notion page: under a page, or as a row of a data source. Takes the parent, a title, property values as plain values (for a row), content as markdown, and an optional template. For a row, the data source schema is read once and each value is encoded against it. Returns the new page''s id, url, title, parent and properties. A failed create is not sent again; a create that got no answer may still have happened, and notion_search by title shows whether it did. Content and a template are not taken together.', input_schema_json = '{"type":"object","properties":{"parent_page_id":{"type":"string","description":"The parent page''s Notion id or URL. Exactly one of parent_page_id and parent_data_source_id is set."},"parent_data_source_id":{"type":"string","description":"The parent data source''s Notion id (notion_get_database lists a database''s data sources). The page becomes a row of it. Exactly one of parent_page_id and parent_data_source_id is set."},"title":{"type":"string","description":"The page''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"properties":{"type":"object","description":"Property values as plain values keyed by property name, the shape notion_get_page returns: {\"Status\": \"Done\", \"Tags\": [\"Docs\"], \"Due\": \"2026-10-30\", \"Estimate\": 3, \"Owner\": [\"<user id>\"], \"Done\": true}. Values are checked against the data source schema before the write: an unknown name, a wrong value type or a select or status option that does not exist is refused in words, with the names the schema has. People and relations take ids; files take links; null clears a value. Formula, rollup, created and edited times, and unique ids are set by Notion and refused."},"content":{"type":"string","description":"The page content as Notion''s enhanced markdown, with headings, lists, tables, code and to-dos. Absent creates an empty page."},"template":{"type":"string","description":"\"default\" for the data source''s default template, or a template page''s id or URL. Notion fills in the template''s content and properties in the background after the call returns."},"allow_async":{"type":"boolean","description":"With content, true lets Notion accept a large page and build it in the background; the result is then a task id, not the page."}}}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_page'
    AND md5(t.description) = 'b795b654e02a418e5c24f542b514a329'
    AND md5(t.input_schema_json::text) = '23b145bb113006c8018dda24be06da20'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_page: expected 1 row, updated %', n; END IF;

  -- notion_create_view
  UPDATE tools t SET description = 'Adds a view to a Notion database: a table, board, list, calendar, timeline, gallery, form, chart, map or dashboard over one of its data sources, with an optional filter, sorts and layout configuration in Notion''s JSON. Returns the view''s id, name, type, database_id, data_source_id, url, filter and sorts. The view id is what notion_query_data_source takes as view_id.', input_schema_json = '{"type":"object","properties":{"database_id":{"type":"string","description":"The database''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"data_source_id":{"type":"string","description":"The data source the view shows''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"name":{"type":"string","description":"The view''s name, shown on its tab."},"type":{"type":"string","enum":["table","board","list","calendar","timeline","gallery","form","chart","map","dashboard"],"description":"The view''s layout, one of the listed types."},"filter":{"type":"object","description":"A Notion filter object, sent unchanged, in the form notion_query_data_source takes."},"sorts":{"type":"array","items":{"type":"object"},"description":"A list of Notion sort objects, sent unchanged."},"configuration":{"type":"object","description":"Notion''s view configuration object, sent unchanged; its type matches the view''s type (for example a board''s group_by)."}},"required":["database_id","data_source_id","name","type"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_create_view'
    AND md5(t.description) = 'c3874090b1056ac6e057ab7dc26600ae'
    AND md5(t.input_schema_json::text) = '09469d141763829ebb7ecf8b5279131f'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_create_view: expected 1 row, updated %', n; END IF;

  -- notion_delete_comment
  UPDATE tools t SET description = 'Deletes one Notion comment. Notion''s API deletes only comments created through the same connection, and answers not found for any other. Returns the comment id and deleted true.', input_schema_json = '{"type":"object","properties":{"comment_id":{"type":"string","description":"The comment''s id, from notion_get_comments or notion_create_comment."}},"required":["comment_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_delete_comment'
    AND md5(t.description) = 'b7d49c6daab72b3f15184aa884d8ce46'
    AND md5(t.input_schema_json::text) = 'c578768253cd8ea08b25713170da6842'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_delete_comment: expected 1 row, updated %', n; END IF;

  -- notion_duplicate_page
  UPDATE tools t SET description = 'Copies one Notion page under a parent page or into a data source, by reading the source page and creating a new one; Notion''s API has no duplicate. The copy carries the title, the content as markdown, the icon and cover when they are an emoji or a link, and, in a data source, the property values the target schema accepts. Comments, page history, page-level permissions, files stored in Notion, and blocks with no markdown form are not carried by a duplicate; content is copied as Notion''s markdown rendering, so some block formatting can differ. Returns the new page''s id and url, properties_not_copied with the reason for each, unknown_block_ids (blocks that could not be copied) and content_truncated.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The page to copy''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"parent_page_id":{"type":"string","description":"The parent page''s Notion id or URL. Exactly one of parent_page_id and parent_data_source_id is set."},"parent_data_source_id":{"type":"string","description":"The parent data source''s Notion id (notion_get_database lists a database''s data sources). The page becomes a row of it. Exactly one of parent_page_id and parent_data_source_id is set."},"title":{"type":"string","description":"The copy''s title. Absent keeps the source page''s title."}},"required":["page_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_duplicate_page'
    AND md5(t.description) = '41857cec90f5b3b130cb40c5f546ad9c'
    AND md5(t.input_schema_json::text) = 'b0888fc269e8d40c0e7064b402461c82'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_duplicate_page: expected 1 row, updated %', n; END IF;

  -- notion_get_comments
  UPDATE tools t SET description = 'Reads the open comments on one Notion page or block. Each comment is reduced to id, discussion_id (comments in one thread share it), created_time, created_by (a name, or an id when Notion gives no name), text and parent. Resolved comments are not returned by Notion''s API. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them.', input_schema_json = '{"type":"object","properties":{"block_id":{"type":"string","description":"The page or block''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 50. A full page comes back with has_more true and a next_cursor for the rest."}},"required":["block_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_get_comments'
    AND md5(t.description) = 'f74e43eecbe69685955f4f8470f5206b'
    AND md5(t.input_schema_json::text) = '9b5dbc0e0287fd3f9f3e06789180cb63'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_get_comments: expected 1 row, updated %', n; END IF;

  -- notion_get_database
  UPDATE tools t SET description = 'Reads one Notion database and the schema of each of its data sources. In Notion''s current API a database is a container of one or more data sources, and rows and properties live on the data source; most databases have one. Returns the database''s id, title, url, parent and in_trash, and data_sources: for each, its id, name and properties as a list of {name, type}, with options (the option names) for select, multi_select and status properties. The data source id is the one notion_query_data_source takes.', input_schema_json = '{"type":"object","properties":{"database_id":{"type":"string","description":"The database''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."}},"required":["database_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_get_database'
    AND md5(t.description) = '123ea23b1dd81932088741d3f7502439'
    AND md5(t.input_schema_json::text) = 'a5ecb6dc18e69e4add300f1e4331c3ad'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_get_database: expected 1 row, updated %', n; END IF;

  -- notion_get_page
  UPDATE tools t SET description = 'Reads one Notion page: its title, url, parent, timestamps and properties, and its content as markdown. Properties come back as plain values keyed by property name, for example {"Status": "Done", "Assignee": ["Test User"], "Due": "2026-10-20"}. A database row is a page, so a row''s id returns that row. The markdown is Notion''s own rendering; truncated is true when Notion cut it short (very long pages), and unknown_block_ids lists blocks with no markdown form, such as embeds and link previews. A page that is not shared with the DataToRAG connection reads as not found.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"include_markdown":{"type":"boolean","description":"Whether to fetch the page content as markdown, which is a second request. Default true. False returns the properties alone, which is enough to read a database row''s values."}},"required":["page_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_get_page'
    AND md5(t.description) = '933264016ebec633f12472402e296e5f'
    AND md5(t.input_schema_json::text) = 'd89914a399f1316724c8e35bab5a6f4e'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_get_page: expected 1 row, updated %', n; END IF;

  -- notion_list_users
  UPDATE tools t SET description = 'Lists the people and bots in the Notion workspace, or reads one of them. Each user is reduced to id, type (person or bot), name, and email for a person when Notion includes it; a bot also carries workspace_name. With user_id set to "me", returns the DataToRAG connection''s own bot user, whose workspace_name names the workspace this connection is in. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them. A single user comes back in the same shape, as a one-item results list.', input_schema_json = '{"type":"object","properties":{"user_id":{"type":"string","description":"A Notion user id, with or without dashes, or \"me\" for the connection''s own bot user. Absent lists the workspace."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 50. A full page comes back with has_more true and a next_cursor for the rest."}}}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_list_users'
    AND md5(t.description) = '22f9f52044a7f5108865fa4fdfac4328'
    AND md5(t.input_schema_json::text) = 'fe87d59ab503a317c996cf7d4ee5ba7b'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_list_users: expected 1 row, updated %', n; END IF;

  -- notion_move_page
  UPDATE tools t SET description = 'Moves one Notion page to a new parent: another page, or a data source (where it becomes a row). Pages only; Notion''s API does not move databases or other blocks. Returns the page''s id, url and new parent.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"parent_page_id":{"type":"string","description":"The parent page''s Notion id or URL. Exactly one of parent_page_id and parent_data_source_id is set."},"parent_data_source_id":{"type":"string","description":"The parent data source''s Notion id (notion_get_database lists a database''s data sources). The page becomes a row of it. Exactly one of parent_page_id and parent_data_source_id is set."}},"required":["page_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_move_page'
    AND md5(t.description) = 'c03625344aeb505297de380a10558a2e'
    AND md5(t.input_schema_json::text) = 'bc72e0af722a43cfa1fe3774ce446ba3'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_move_page: expected 1 row, updated %', n; END IF;

  -- notion_query_data_source
  UPDATE tools t SET description = 'Reads the rows of one Notion data source (a table inside a database), with an optional filter, sort order, property allowlist, page size and cursor. Each row is {id, url, created_time, last_edited_time, properties}, with properties as plain values keyed by property name. Filter and sorts are passed to Notion as written, in Notion''s query JSON; notion_get_database lists the property names and types they refer to. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them. With view_id in place of data_source_id, the rows are a saved view''s, in its own filter and sort order, and each row is its id alone, which is what Notion''s view query returns; notion_get_page reads a row''s properties. A view query''s results stay cached for 15 minutes; total_count is the number of rows it matched, and incomplete true means Notion''s 10,000-row cache cut them short.', input_schema_json = '{"type":"object","properties":{"data_source_id":{"type":"string","description":"The data source''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"view_id":{"type":"string","description":"A database view''s id, or a database URL whose ?v= names the view. Takes the place of data_source_id; filter, sorts and properties are not taken with it."},"filter":{"type":"object","description":"A Notion filter object, sent unchanged. Example: {\"property\": \"Status\", \"status\": {\"equals\": \"Done\"}}; compound filters use {\"and\": [...]} or {\"or\": [...]}. Notion''s filter reference documents the condition each property type takes. Absent returns every row."},"sorts":{"type":"array","items":{"type":"object"},"description":"A list of Notion sort objects, sent unchanged, applied in order. Example: [{\"property\": \"Due\", \"direction\": \"ascending\"}] or [{\"timestamp\": \"last_edited_time\", \"direction\": \"descending\"}]."},"properties":{"type":"array","items":{"type":"string"},"description":"Property names to keep in each row. Absent keeps every property. Names that a row does not have are left out of that row."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 25. A full page comes back with has_more true and a next_cursor for the rest."}}}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_query_data_source'
    AND md5(t.description) = '116c0aa955cc6a1982c372a5cfbf0cda'
    AND md5(t.input_schema_json::text) = '1c212524a7966181c243fce3d7507cd7'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_query_data_source: expected 1 row, updated %', n; END IF;

  -- notion_search
  UPDATE tools t SET description = 'Searches the Notion pages and data sources shared with the DataToRAG connection, by title. Notion''s search matches titles, not page content, and Notion describes its index as not immediate and not guaranteed complete, so a page created moments ago can be missing. Takes an optional query, an optional object type, a page size and a cursor. Each result is reduced to id, object (page or data_source), title, url, parent ({type, id}) and last_edited_time. The result is {results, has_more, next_cursor}, with the same shape when there are no results. has_more true means more results exist than this page holds, and next_cursor is the cursor argument that returns them. A page or database that exists but is not shared with the connection does not appear.', input_schema_json = '{"type":"object","properties":{"query":{"type":"string","description":"Text matched against titles. Absent or empty returns every shared page and data source, most recently edited at the top."},"object":{"type":"string","enum":["page","data_source"],"description":"Limits results to pages or to data sources (the tables inside a database). Absent returns both."},"cursor":{"type":"string","description":"The next_cursor value from an earlier call with the same arguments. Returns the page of results after that one. Absent for the start of the list."},"page_size":{"type":"integer","minimum":1,"maximum":100,"description":"How many results one call returns, from 1 to 100. Default 20. A full page comes back with has_more true and a next_cursor for the rest."}}}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_search'
    AND md5(t.description) = 'ff84d00b0edc5bc3f843faf03031697c'
    AND md5(t.input_schema_json::text) = '22620786e7a3e99149f7ac2e0c31d512'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_search: expected 1 row, updated %', n; END IF;

  -- notion_update_comment
  UPDATE tools t SET description = 'Replaces the text of one Notion comment. Notion''s API edits only comments created through the same connection, and answers not found for any other. Returns the comment.', input_schema_json = '{"type":"object","properties":{"comment_id":{"type":"string","description":"The comment''s id, from notion_get_comments or notion_create_comment."},"text":{"type":"string","description":"The new text, as plain text. Over 2,000 characters is split into several text pieces."}},"required":["comment_id","text"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_comment'
    AND md5(t.description) = '1a13b5b758635326d5ecac715b4494e9'
    AND md5(t.input_schema_json::text) = 'e0619beadf5b0b6f97e61369747601ba'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_comment: expected 1 row, updated %', n; END IF;

  -- notion_update_data_source
  UPDATE tools t SET description = 'Changes one Notion data source (the table inside a database): its title, its property schema, or whether it is in the trash. The schema change is a map keyed by a property''s current name: null removes the property for every row, {"name": "New"} renames it, and a type (alone or with name) changes its type and settings, in the forms notion_create_database takes. A select''s options list replaces the whole list. Changing a type can leave existing values unreadable in the new type. Returns the data source''s id, title, in_trash and property schema.', input_schema_json = '{"type":"object","properties":{"data_source_id":{"type":"string","description":"The data source''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"title":{"type":"string","description":"The data source''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"properties":{"type":"object","description":"Property changes keyed by current name: null removes, {\"name\": \"...\"} renames, a type or {\"type\": ..., settings} changes the type."},"in_trash":{"type":"boolean","description":"true moves the data source to the trash; false restores it."}},"required":["data_source_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_data_source'
    AND md5(t.description) = 'feea0b5d1bdb4b42c38e0dd8c4f145d3'
    AND md5(t.input_schema_json::text) = '2fcea0e05b63fbfc8dca05691348ccb9'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_data_source: expected 1 row, updated %', n; END IF;

  -- notion_update_page
  UPDATE tools t SET description = 'Changes one Notion page''s title, property values, icon or cover, applies a template, or moves it to or from the trash. Property values are plain values checked against the page''s data source schema (one read of the page and one of its schema). in_trash true is how a page is deleted through Notion''s API, and in_trash false restores it. Omitted properties keep their values; a list value replaces the whole list. Returns the page''s id, url, title, parent, in_trash and properties.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"title":{"type":"string","description":"The page''s title as plain text. Over 2,000 characters is split into several text pieces; the limit is 200,000."},"properties":{"type":"object","description":"Property values as plain values keyed by property name, the shape notion_get_page returns: {\"Status\": \"Done\", \"Tags\": [\"Docs\"], \"Due\": \"2026-10-30\", \"Estimate\": 3, \"Owner\": [\"<user id>\"], \"Done\": true}. Values are checked against the data source schema before the write: an unknown name, a wrong value type or a select or status option that does not exist is refused in words, with the names the schema has. People and relations take ids; files take links; null clears a value. Formula, rollup, created and edited times, and unique ids are set by Notion and refused."},"icon":{"type":["string","null"],"description":"An emoji, or an image URL. null removes the icon."},"cover":{"type":["string","null"],"description":"A cover image URL. null removes the cover."},"in_trash":{"type":"boolean","description":"true moves the page to the trash (the delete); false restores it from the trash."},"template":{"type":"string","description":"\"default\" for the data source''s default template, or a template page''s id or URL. Notion fills in the template''s content and properties in the background after the call returns."}},"required":["page_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_page'
    AND md5(t.description) = '0bee3af4c59b25e7e2e82e406d189b32'
    AND md5(t.input_schema_json::text) = 'a2efe507f1a3529c604d7743c688ed7e'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_page: expected 1 row, updated %', n; END IF;

  -- notion_update_page_content
  UPDATE tools t SET description = 'Edits one Notion page''s content as markdown, in one of three modes. edits replaces exact passages, each {old_str, new_str, replace_all_matches}; an edit whose old_str matches nothing is listed in warnings while the others apply. replace_with replaces the whole content. insert adds markdown at the start, at the end (the default), or after a selection. Child pages and databases are kept unless allow_deleting_content is true, and Notion refuses an edit that would remove them. The content of a synced page is not edited through Notion''s API. Returns the page id and Notion''s warnings.', input_schema_json = '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id, with or without dashes, or a Notion URL that contains it (the id is read from the URL)."},"edits":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"old_str":{"type":"string","description":"Text in the page''s markdown, matched exactly. Not empty."},"new_str":{"type":"string","description":"The text that replaces old_str. Empty deletes the passage."},"replace_all_matches":{"type":"boolean","description":"true replaces every match. Default false, where an old_str with several matches is refused by Notion."}},"required":["old_str","new_str"]},"description":"Passage replacements, at most 100, applied in one request. notion_get_page shows the markdown they match against."},"replace_with":{"type":"string","description":"Markdown that replaces the page''s whole content."},"insert":{"type":"string","description":"Markdown to add to the page, placed by position or after."},"position":{"type":"string","enum":["start","end"],"description":"With insert: start or end of the page. Default end."},"after":{"type":"string","description":"With insert: a selection of existing content to insert after, written \"start text...end text\"."},"allow_deleting_content":{"type":"boolean","description":"With edits or replace_with: true lets the change remove child pages and databases. Sent to Notion only when set."},"allow_async":{"type":"boolean","description":"true lets Notion apply a large change in the background; the result is then a task id and carries no warnings."}},"required":["page_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_page_content'
    AND md5(t.description) = 'a10643ebfa632ad139cc83019c0f391c'
    AND md5(t.input_schema_json::text) = '713dfe3911b38c7ddaa828c738835f03'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_page_content: expected 1 row, updated %', n; END IF;

  -- notion_update_view
  UPDATE tools t SET description = 'Changes one Notion database view''s name, filter, sorts or layout configuration. null clears the filter or the sorts; omitted fields keep their values. A view''s type is not changed through Notion''s API. Returns the view in the shape notion_create_view returns.', input_schema_json = '{"type":"object","properties":{"view_id":{"type":"string","description":"The view''s id, or a database URL whose ?v= names the view."},"name":{"type":"string","description":"The view''s new name, shown on its tab."},"filter":{"type":["object","null"],"description":"A Notion filter object, sent unchanged. null clears the filter."},"sorts":{"type":["array","null"],"items":{"type":"object"},"description":"A list of Notion property sort objects, sent unchanged. null clears the sorts."},"configuration":{"type":"object","description":"Notion''s view configuration object, sent unchanged."}},"required":["view_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'notion-mcp' AND t.name = 'notion_update_view'
    AND md5(t.description) = '1e1ec151797d18979f4e508a01821696'
    AND md5(t.input_schema_json::text) = 'f56fcb4879281aaeecd106fccda3401a'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_update_view: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'notion-mcp';
  IF n <> 18 THEN RAISE EXCEPTION 'rows for notion-mcp: expected 18, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'notion-mcp' AND t.name IN ('notion_create_comment', 'notion_create_database', 'notion_create_page', 'notion_create_view', 'notion_delete_comment', 'notion_duplicate_page', 'notion_get_comments', 'notion_get_database', 'notion_get_page', 'notion_list_users', 'notion_move_page', 'notion_query_data_source', 'notion_search', 'notion_update_comment', 'notion_update_data_source', 'notion_update_page', 'notion_update_page_content', 'notion_update_view');
COMMIT;
