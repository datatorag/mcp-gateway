-- Registry change for brevo-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway cba2a86554a9707df00ba4c2081533c5982fd515 (what is running) and 2c430114043d8a7b05b490786d64e755b85a8cab.
-- A NEW plugin, by --new-plugin: the tool file kept for cba2a86554a9707df00ba4c2081533c5982fd515 is not read, whatever it holds.
-- Its mcp_servers row is inserted first, from plugins/brevo-mcp/datatorag.json and package.json at 2c430114043d8a7b05b490786d64e755b85a8cab:
--   name, description, the manifest as manifest_json, the license, a source link in this repository,
--   status active, and container_port the lowest port from 40000 that no mcp_servers row holds,
--   chosen by the statement itself. It raises if a row for brevo-mcp already exists.
-- 0 row(s) change, 20 added, 0 removed.
-- Rows for brevo-mcp: 0 before, 20 after.
--   adds account_get
--   adds campaign_create
--   adds campaign_export_recipients
--   adds campaign_get
--   adds campaign_send
--   adds campaign_send_test
--   adds campaign_set_status
--   adds campaign_update
--   adds campaigns_list
--   adds contact_create
--   adds contact_get
--   adds contact_update
--   adds contacts_search
--   adds email_log
--   adds email_send
--   adds email_stats
--   adds list_members_update
--   adds lists_get
--   adds process_get
--   adds templates_get
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
  -- brevo-mcp: a new plugin, its server row
  INSERT INTO mcp_servers (slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json, status, container_port)
  SELECT 'brevo-mcp', 'Brevo',
    'Brevo: contacts and lists, email campaigns and their reports, transactional email, templates and the send log',
    'https://github.com/datatorag/mcp-gateway/tree/main/plugins/brevo-mcp', 'datatorag', 'mcp-gateway',
    NULL,
    '{"name":"Brevo","description":"Brevo: contacts and lists, email campaigns and their reports, transactional email, templates and the send log","oauth":{"provider":"brevo","authorizeUrl":"https://oauth.brevo.com/realms/partner/oauth/authorize","tokenUrl":"https://oauth.brevo.com/realms/partner/oauth/token","clientIdEnv":"$BREVO_OAUTH_CLIENT_ID","clientSecretEnv":"$BREVO_OAUTH_CLIENT_SECRET","scopes":["account:read","contacts:read","contacts:write","campaigns.email:read","campaigns.email:write","transactional.email:read","transactional.email:write","offline_access","openid","email"]}}'::jsonb,
    'active',
    (SELECT min(p.port) FROM generate_series(40000, 40999) AS p(port) WHERE NOT EXISTS (SELECT 1 FROM mcp_servers o WHERE o.container_port = p.port))
  WHERE NOT EXISTS (SELECT 1 FROM mcp_servers s WHERE s.slug = 'brevo-mcp');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers brevo-mcp: expected 1 row, inserted %', n; END IF;
  SELECT count(*) INTO n FROM mcp_servers s JOIN mcp_servers o ON o.container_port = s.container_port WHERE s.slug = 'brevo-mcp';
  IF n <> 1 THEN RAISE EXCEPTION 'forward mcp_servers brevo-mcp: expected 1 row on its port, found %', n; END IF;

  -- account_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'account_get', 'brevo-mcp__account_get',
    'The connected Brevo account: its company, its plan, and its credits, including how many emails it can still send today. Read this before a send to know the limit left.',
    '{"type":"object","properties":{},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__account_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward account_get: expected 1 row, inserted %', n; END IF;

  -- campaign_create: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaign_create', 'brevo-mcp__campaign_create',
    'Creates an email campaign as a draft: name, subject, sender, a body (HTML or a template) and the lists it goes to. Nothing is sent; campaign_send_test sends a test and campaign_send sends it.',
    '{"type":"object","properties":{"name":{"type":"string","description":"The campaign''s name, which recipients do not see."},"subject":{"type":"string","description":"The subject line."},"sender_email":{"type":"string","description":"The sender''s address; it must be a sender verified in Brevo."},"sender_name":{"type":"string","description":"The sender''s name."},"html_content":{"type":"string","description":"The body as HTML, under 1 MB. Not with template_id."},"template_id":{"type":"integer","minimum":1,"description":"Use this Brevo template as the body. Not with html_content."},"list_ids":{"type":"array","items":{"type":"integer","minimum":1},"description":"The lists the campaign goes to."},"reply_to":{"type":"string","description":"Where replies go."},"preview_text":{"type":"string","description":"The preview line shown after the subject."}},"required":["name","subject","sender_email","list_ids"],"additionalProperties":false}'::jsonb,
    false, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaign_create');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaign_create: expected 1 row, inserted %', n; END IF;

  -- campaign_export_recipients: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaign_export_recipients', 'brevo-mcp__campaign_export_recipients',
    'Starts Brevo''s export of a sent campaign''s recipients of one kind (all, openers, clickers, bounces, unsubscribed and so on) and answers with a process id. Brevo builds the file in the background; process_get says when it is ready and where Brevo has put it. Changes nothing.',
    '{"type":"object","properties":{"campaign_id":{"type":"integer","minimum":1,"description":"The campaign''s id."},"recipients_type":{"type":"string","enum":["all","nonClickers","nonOpeners","clickers","openers","softBounces","hardBounces","unsubscribed"],"description":"Which recipients to export."}},"required":["campaign_id","recipients_type"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaign_export_recipients');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaign_export_recipients: expected 1 row, inserted %', n; END IF;

  -- campaign_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaign_get', 'brevo-mcp__campaign_get',
    'One email campaign: its settings, recipients and status, and its report when statistics is given (globalStats for the totals, or linksStats, statsByDomain, statsByDevice, statsByBrowser). Its HTML only with include_html, capped.',
    '{"type":"object","properties":{"campaign_id":{"type":"integer","minimum":1,"description":"The campaign''s id."},"statistics":{"type":"string","enum":["globalStats","linksStats","statsByDomain","statsByDevice","statsByBrowser"],"description":"Which report to include."},"include_html":{"type":"boolean","description":"Also return the HTML body. Off by default, because it is large."},"max_html_chars":{"type":"integer","minimum":1,"maximum":200000,"description":"Cut the HTML at this many characters, saying how much was left out. Default 20000."}},"required":["campaign_id"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaign_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaign_get: expected 1 row, inserted %', n; END IF;

  -- campaign_send: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaign_send', 'brevo-mcp__campaign_send',
    'Sends an email campaign to every recipient on its lists, now, or at scheduled_at. A sent campaign cannot be recalled; a scheduled one can be stopped with campaign_set_status suspended. It first reads the account''s send limit, and sends nothing when the limit left is below the number of contacts the campaign''s lists hold, answering with both numbers.',
    '{"type":"object","properties":{"campaign_id":{"type":"integer","minimum":1,"description":"The campaign''s id."},"scheduled_at":{"type":"string","description":"Send at this ISO date and time instead of now, e.g. 2026-11-02T09:00:00Z."}},"required":["campaign_id"],"additionalProperties":false}'::jsonb,
    false, true
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaign_send');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaign_send: expected 1 row, inserted %', n; END IF;

  -- campaign_send_test: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaign_send_test', 'brevo-mcp__campaign_send_test',
    'Sends a test of an email campaign to the addresses named, and to no one else. A sent test cannot be recalled. Brevo allows fifty tests a day.',
    '{"type":"object","properties":{"campaign_id":{"type":"integer","minimum":1,"description":"The campaign''s id."},"emails":{"type":"array","items":{"type":"string"},"description":"Where the test goes."}},"required":["campaign_id","emails"],"additionalProperties":false}'::jsonb,
    false, true
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaign_send_test');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaign_send_test: expected 1 row, inserted %', n; END IF;

  -- campaign_set_status: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaign_set_status', 'brevo-mcp__campaign_set_status',
    'Sets an email campaign''s status: suspended stops a scheduled campaign from sending, draft takes it back to a draft, archive and darchive archive and unarchive it.',
    '{"type":"object","properties":{"campaign_id":{"type":"integer","minimum":1,"description":"The campaign''s id."},"status":{"type":"string","enum":["suspended","draft","archive","darchive"],"description":"The new status."}},"required":["campaign_id","status"],"additionalProperties":false}'::jsonb,
    false, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaign_set_status');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaign_set_status: expected 1 row, inserted %', n; END IF;

  -- campaign_update: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaign_update', 'brevo-mcp__campaign_update',
    'Changes a draft or scheduled email campaign: any of its name, subject, sender, body, lists, reply-to and preview text. Scheduling is not here; it is campaign_send with scheduled_at.',
    '{"type":"object","properties":{"campaign_id":{"type":"integer","minimum":1,"description":"The campaign''s id."},"name":{"type":"string","description":"The campaign''s name, which recipients do not see."},"subject":{"type":"string","description":"The subject line."},"sender_email":{"type":"string","description":"The sender''s address; it must be a sender verified in Brevo."},"sender_name":{"type":"string","description":"The sender''s name."},"html_content":{"type":"string","description":"The body as HTML, under 1 MB. Not with template_id."},"template_id":{"type":"integer","minimum":1,"description":"Use this Brevo template as the body. Not with html_content."},"list_ids":{"type":"array","items":{"type":"integer","minimum":1},"description":"The lists the campaign goes to."},"reply_to":{"type":"string","description":"Where replies go."},"preview_text":{"type":"string","description":"The preview line shown after the subject."}},"required":["campaign_id"],"additionalProperties":false}'::jsonb,
    false, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaign_update');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaign_update: expected 1 row, inserted %', n; END IF;

  -- campaigns_list: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'campaigns_list', 'brevo-mcp__campaigns_list',
    'Email campaigns, without their HTML. Use campaign_get for one campaign''s body and report.',
    '{"type":"object","properties":{"status":{"type":"string","enum":["draft","sent","archive","queued","suspended","inProcess"],"description":"Only campaigns in this status."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 50."},"offset":{"type":"integer","minimum":0,"description":"How many to skip, to page through. Default 0."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__campaigns_list');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward campaigns_list: expected 1 row, inserted %', n; END IF;

  -- contact_create: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'contact_create', 'brevo-mcp__contact_create',
    'Creates a contact with an email address, optional attributes (FIRSTNAME, LASTNAME and the account''s own) and the lists to put it on. With update_enabled, an existing contact with that address is updated instead.',
    '{"type":"object","properties":{"email":{"type":"string","description":"The contact''s email address."},"attributes":{"type":"object","description":"Attribute names to values, as Brevo names them: {\"FIRSTNAME\": \"Jane\"}."},"list_ids":{"type":"array","items":{"type":"integer","minimum":1},"description":"Lists to add the contact to."},"update_enabled":{"type":"boolean","description":"Update the contact if one with this address exists. Default false."}},"required":["email"],"additionalProperties":false}'::jsonb,
    false, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__contact_create');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contact_create: expected 1 row, inserted %', n; END IF;

  -- contact_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'contact_get', 'brevo-mcp__contact_get',
    'One contact by email address or Brevo contact id: its attributes and the lists it is on. Its per-campaign statistics only with include_stats.',
    '{"type":"object","properties":{"identifier":{"type":"string","description":"The contact''s email address or Brevo contact id."},"include_stats":{"type":"boolean","description":"Also return what the contact did with each campaign. Off by default."}},"required":["identifier"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__contact_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contact_get: expected 1 row, inserted %', n; END IF;

  -- contact_update: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'contact_update', 'brevo-mcp__contact_update',
    'Changes a contact, found by email address or Brevo contact id: its attributes, lists to add it to, lists to take it off.',
    '{"type":"object","properties":{"identifier":{"type":"string","description":"The contact''s email address or Brevo contact id."},"attributes":{"type":"object","description":"Attribute names to new values."},"list_ids":{"type":"array","items":{"type":"integer","minimum":1},"description":"Lists to add the contact to."},"unlink_list_ids":{"type":"array","items":{"type":"integer","minimum":1},"description":"Lists to take the contact off."}},"required":["identifier"],"additionalProperties":false}'::jsonb,
    false, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__contact_update');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contact_update: expected 1 row, inserted %', n; END IF;

  -- contacts_search: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'contacts_search', 'brevo-mcp__contacts_search',
    'Finds contacts, or lists the members of one list when list_id is given. filter takes Brevo''s one operator, equals, on a contact attribute: equals(FIRSTNAME,"Jane"). modified_since and created_since take an ISO date and time.',
    '{"type":"object","properties":{"list_id":{"type":"integer","minimum":1,"description":"Only the members of this list."},"filter":{"type":"string","description":"equals(ATTRIBUTE,\"value\"), Brevo''s only filter. Not with list_id."},"modified_since":{"type":"string","description":"Only contacts changed since this ISO date and time."},"created_since":{"type":"string","description":"Only contacts created since this ISO date and time. Not with list_id."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 50."},"offset":{"type":"integer","minimum":0,"description":"How many to skip, to page through. Default 0."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__contacts_search');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward contacts_search: expected 1 row, inserted %', n; END IF;

  -- email_log: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'email_log', 'brevo-mcp__email_log',
    'What happened to transactional emails, event by event, newest first: delivered, opened, clicked, bounced and so on. Narrow by email, event, template_id or message_id, and by days (up to 90) or start_date and end_date.',
    '{"type":"object","properties":{"email":{"type":"string","description":"Only events for this recipient address."},"event":{"type":"string","enum":["bounces","hardBounces","softBounces","delivered","spam","requests","opened","clicks","invalid","deferred","blocked","unsubscribed","error","loadedByProxy"],"description":"Only this kind of event."},"template_id":{"type":"integer","minimum":1,"description":"Only emails sent from this template."},"message_id":{"type":"string","description":"Only this email."},"days":{"type":"integer","minimum":1,"maximum":90,"description":"The last this many days."},"start_date":{"type":"string","description":"YYYY-MM-DD, with end_date."},"end_date":{"type":"string","description":"YYYY-MM-DD, with start_date."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 50."},"offset":{"type":"integer","minimum":0,"description":"How many to skip, to page through. Default 0."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__email_log');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward email_log: expected 1 row, inserted %', n; END IF;

  -- email_send: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'email_send', 'brevo-mcp__email_send',
    'Sends a transactional email from a Brevo template to the recipients named (at most 50), now or at scheduled_at, with params filling the template''s placeholders. A sent email cannot be recalled.',
    '{"type":"object","properties":{"template_id":{"type":"integer","minimum":1,"description":"The template to send."},"to":{"type":"array","items":{"type":"object","properties":{"email":{"type":"string"},"name":{"type":"string"}},"required":["email"]},"description":"The recipients."},"params":{"type":"object","description":"Values for the template''s {{ params.NAME }} placeholders."},"scheduled_at":{"type":"string","description":"Send at this ISO date and time instead of now."},"tags":{"type":"array","items":{"type":"string"},"description":"Tags to find the email by in email_log and email_stats."}},"required":["template_id","to"],"additionalProperties":false}'::jsonb,
    false, true
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__email_send');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward email_send: expected 1 row, inserted %', n; END IF;

  -- email_stats: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'email_stats', 'brevo-mcp__email_stats',
    'Transactional email totals over a period: requests, delivered, opens, clicks, bounces, spam reports, unsubscribes. Give days (up to 90), or start_date and end_date; the default is Brevo''s. A campaign''s own numbers are campaign_get with statistics.',
    '{"type":"object","properties":{"days":{"type":"integer","minimum":1,"maximum":90,"description":"The last this many days."},"start_date":{"type":"string","description":"YYYY-MM-DD, with end_date."},"end_date":{"type":"string","description":"YYYY-MM-DD, with start_date."},"tag":{"type":"string","description":"Only emails sent with this tag."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__email_stats');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward email_stats: expected 1 row, inserted %', n; END IF;

  -- list_members_update: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'list_members_update', 'brevo-mcp__list_members_update',
    'Adds contacts to a list, takes them off it, or both, by email address, at most 150 each way per call.',
    '{"type":"object","properties":{"list_id":{"type":"integer","minimum":1,"description":"The list."},"add":{"type":"array","items":{"type":"string"},"description":"Email addresses to add."},"remove":{"type":"array","items":{"type":"string"},"description":"Email addresses to take off."}},"required":["list_id"],"additionalProperties":false}'::jsonb,
    false, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__list_members_update');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward list_members_update: expected 1 row, inserted %', n; END IF;

  -- lists_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'lists_get', 'brevo-mcp__lists_get',
    'Contact lists with how many subscribers each has, or one list when list_id is given.',
    '{"type":"object","properties":{"list_id":{"type":"integer","minimum":1,"description":"One list."},"limit":{"type":"integer","minimum":1,"maximum":50,"description":"How many to return, at most 50. Default 10."},"offset":{"type":"integer","minimum":0,"description":"How many to skip, to page through. Default 0."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__lists_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward lists_get: expected 1 row, inserted %', n; END IF;

  -- process_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'process_get', 'brevo-mcp__process_get',
    'A Brevo background process, such as a recipients export: its status and, when it is done, the address of the file Brevo built.',
    '{"type":"object","properties":{"process_id":{"type":"integer","minimum":1,"description":"The id campaign_export_recipients answered with."}},"required":["process_id"],"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__process_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward process_get: expected 1 row, inserted %', n; END IF;

  -- templates_get: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'templates_get', 'brevo-mcp__templates_get',
    'Transactional email templates without their HTML, or one template when template_id is given, its HTML only with include_html, capped.',
    '{"type":"object","properties":{"template_id":{"type":"integer","minimum":1,"description":"One template."},"active_only":{"type":"boolean","description":"Only active templates. Not with template_id."},"include_html":{"type":"boolean","description":"Also return the HTML body. Off by default, because it is large."},"max_html_chars":{"type":"integer","minimum":1,"maximum":200000,"description":"Cut the HTML at this many characters, saying how much was left out. Default 20000."},"limit":{"type":"integer","minimum":1,"maximum":100,"description":"How many to return, at most 100. Default 50."},"offset":{"type":"integer","minimum":0,"description":"How many to skip, to page through. Default 0."}},"additionalProperties":false}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'brevo-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'brevo-mcp__templates_get');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward templates_get: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'brevo-mcp';
  IF n <> 20 THEN RAISE EXCEPTION 'rows for brevo-mcp: expected 20, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'brevo-mcp' AND t.name IN ('account_get', 'campaign_create', 'campaign_export_recipients', 'campaign_get', 'campaign_send', 'campaign_send_test', 'campaign_set_status', 'campaign_update', 'campaigns_list', 'contact_create', 'contact_get', 'contact_update', 'contacts_search', 'email_log', 'email_send', 'email_stats', 'list_members_update', 'lists_get', 'process_get', 'templates_get');
COMMIT;
