-- ROLLBACK of the registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Returns the rows to what gateway cba2a86554a9707df00ba4c2081533c5982fd515 served, from what 2c430114043d8a7b05b490786d64e755b85a8cab served.
-- Part 3 of 3: rows split in name order, at most 40 to a part; each part stands alone.
-- 7 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   restores tasks_complete: destructive_hint
--   restores tasks_create: destructive_hint
--   restores tasks_create_tasklist: destructive_hint
--   restores tasks_delete: destructive_hint
--   restores tasks_list: destructive_hint
--   restores tasks_list_tasks: destructive_hint
--   restores tasks_update: destructive_hint
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
  -- tasks_complete
  UPDATE tools t SET description = 'Mark a task as completed.', input_schema_json = '{"type":"object","properties":{"tasklist_id":{"type":"string","description":"The task list ID"},"task_id":{"type":"string","description":"The task ID to mark as complete"}},"required":["tasklist_id","task_id"]}'::jsonb, read_only_hint = false, destructive_hint = NULL, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'tasks_complete'
    AND md5(t.description) = '09fcb8af176f2b217f3889c6e4355857'
    AND md5(t.input_schema_json::text) = '0796c7ed2ba23d09197f48071fc7a985'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback tasks_complete: expected 1 row, updated %', n; END IF;

  -- tasks_create
  UPDATE tools t SET description = 'Create one task, or many tasks in one call. Pass title (with notes and due) for one task, or tasks for several: each task is inserted into the shared task list, or into its own tasklist_id where it names one, and the response carries one outcome per task in order (results[]: index, title, ok, id or error) so a partial batch is visible. Create every task of a run in one call rather than one call per task. Give title or tasks, not both.', input_schema_json = '{"type":"object","properties":{"tasklist_id":{"type":"string","description":"The task list ID (or ''@default'' for the default list). The shared list for a tasks batch."},"title":{"type":"string","description":"Title of the task, for the one-task case. Give title or tasks, not both."},"notes":{"type":"string","description":"Notes/description for the task"},"due":{"type":"string","description":"Due date in RFC 3339 format (e.g., 2026-03-28T00:00:00Z)"},"tasks":{"type":"array","description":"Several tasks created in one request, in this order. Each carries its own title, optional notes and due, and may name its own tasklist_id; otherwise the shared tasklist_id applies. Give title or tasks, not both.","items":{"type":"object","properties":{"title":{"type":"string","description":"Title of the task"},"notes":{"type":"string","description":"Notes/description for the task"},"due":{"type":"string","description":"Due date in RFC 3339 format"},"tasklist_id":{"type":"string","description":"A task list for this task only; the shared tasklist_id otherwise"}},"required":["title"]}}},"required":["tasklist_id"]}'::jsonb, read_only_hint = false, destructive_hint = NULL, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'tasks_create'
    AND md5(t.description) = '53b8941fb406314592c4bc94ed0103c2'
    AND md5(t.input_schema_json::text) = '8fb86594991100f33e7feafbe5e1cce8'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback tasks_create: expected 1 row, updated %', n; END IF;

  -- tasks_create_tasklist
  UPDATE tools t SET description = 'Create a new task list. A task list is the container tasks live in — use this when a workflow needs its own list rather than adding to ''@default''.', input_schema_json = '{"type":"object","properties":{"title":{"type":"string","description":"Title of the new task list, as it appears in the Tasks UI"}},"required":["title"]}'::jsonb, read_only_hint = false, destructive_hint = NULL, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'tasks_create_tasklist'
    AND md5(t.description) = '061b7f0f32e653fbcf2ae959bbfac5e3'
    AND md5(t.input_schema_json::text) = '5a3938a0999db2bef43d0770b62770a0'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback tasks_create_tasklist: expected 1 row, updated %', n; END IF;

  -- tasks_delete
  UPDATE tools t SET description = 'Delete a task from a task list.', input_schema_json = '{"type":"object","properties":{"tasklist_id":{"type":"string","description":"The task list ID"},"task_id":{"type":"string","description":"The task ID to delete"}},"required":["tasklist_id","task_id"]}'::jsonb, read_only_hint = false, destructive_hint = NULL, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'tasks_delete'
    AND md5(t.description) = 'db8725f3138fc338bfbbef29dea80763'
    AND md5(t.input_schema_json::text) = '77fdd310fe6b812ef9752b9f10802c62'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback tasks_delete: expected 1 row, updated %', n; END IF;

  -- tasks_list
  UPDATE tools t SET description = 'List all task lists for the authenticated user.', input_schema_json = '{"type":"object","properties":{}}'::jsonb, read_only_hint = true, destructive_hint = NULL, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'tasks_list'
    AND md5(t.description) = '4122b81f181a0c3e3c47cd1b629549d9'
    AND md5(t.input_schema_json::text) = '6cb44a56118e2966acccfb86f18d0570'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback tasks_list: expected 1 row, updated %', n; END IF;

  -- tasks_list_tasks
  UPDATE tools t SET description = 'List tasks in a specific task list. Returns task titles, statuses, due dates, and notes.', input_schema_json = '{"type":"object","properties":{"tasklist_id":{"type":"string","description":"The task list ID (use tasks_list to find IDs, or ''@default'' for the default list)"},"show_completed":{"type":"boolean","description":"Include completed tasks (default: true)"},"show_hidden":{"type":"boolean","description":"Include hidden/deleted tasks (default: false)"}},"required":["tasklist_id"]}'::jsonb, read_only_hint = true, destructive_hint = NULL, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'tasks_list_tasks'
    AND md5(t.description) = '066cf86dbf33b0c2768bd3cc0d1f2cf5'
    AND md5(t.input_schema_json::text) = '829baa7338056278f1a04f110d918814'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM false
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback tasks_list_tasks: expected 1 row, updated %', n; END IF;

  -- tasks_update
  UPDATE tools t SET description = 'Update an existing task''s title, notes, or due date.', input_schema_json = '{"type":"object","properties":{"tasklist_id":{"type":"string","description":"The task list ID"},"task_id":{"type":"string","description":"The task ID to update"},"title":{"type":"string","description":"New title for the task"},"notes":{"type":"string","description":"New notes for the task"},"due":{"type":"string","description":"New due date in RFC 3339 format"}},"required":["tasklist_id","task_id"]}'::jsonb, read_only_hint = false, destructive_hint = NULL, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'tasks_update'
    AND md5(t.description) = '31160cd934577e65d9eccc7769228472'
    AND md5(t.input_schema_json::text) = '7001375b451b1e7c0ed1423658162043'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM true
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'rollback tasks_update: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('tasks_complete', 'tasks_create', 'tasks_create_tasklist', 'tasks_delete', 'tasks_list', 'tasks_list_tasks', 'tasks_update');
COMMIT;
