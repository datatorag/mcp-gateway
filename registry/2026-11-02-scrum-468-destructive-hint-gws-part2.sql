-- Registry change for gws-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway cba2a86554a9707df00ba4c2081533c5982fd515 (what is running) and 2c430114043d8a7b05b490786d64e755b85a8cab.
-- Part 2 of 3: rows split in name order, at most 40 to a part; each part stands alone.
-- 40 row(s) change, 0 added, 0 removed.
-- Rows for gws-mcp: 87 before, 87 after.
--   changes gmail_list: destructive_hint
--   changes gmail_list_drafts: destructive_hint
--   changes gmail_list_filters: destructive_hint
--   changes gmail_list_labels: destructive_hint
--   changes gmail_mark_read: destructive_hint
--   changes gmail_mark_spam: destructive_hint
--   changes gmail_read: destructive_hint
--   changes gmail_reply: destructive_hint
--   changes gmail_save_attachment_to_drive: destructive_hint
--   changes gmail_search: destructive_hint
--   changes gmail_send: destructive_hint
--   changes gmail_send_draft: destructive_hint
--   changes gmail_trash: destructive_hint
--   changes gmail_trash_thread: destructive_hint
--   changes gmail_unmark_spam: destructive_hint
--   changes gmail_untrash: destructive_hint
--   changes gmail_untrash_thread: destructive_hint
--   changes gmail_update_draft: destructive_hint
--   changes gmail_update_label: destructive_hint
--   changes gws_run: destructive_hint
--   changes sheets_add_tab: destructive_hint
--   changes sheets_append: destructive_hint
--   changes sheets_batch_update: destructive_hint
--   changes sheets_clear: destructive_hint
--   changes sheets_copy_tab_to: destructive_hint
--   changes sheets_create: destructive_hint
--   changes sheets_delete: destructive_hint
--   changes sheets_delete_tab: destructive_hint
--   changes sheets_find_rows: destructive_hint
--   changes sheets_format_range: destructive_hint
--   changes sheets_format_table: destructive_hint
--   changes sheets_get_metadata: destructive_hint
--   changes sheets_query: destructive_hint
--   changes sheets_read: destructive_hint
--   changes sheets_rename_tab: destructive_hint
--   changes sheets_update: destructive_hint
--   changes slides_batch_update: destructive_hint
--   changes slides_create: destructive_hint
--   changes slides_delete: destructive_hint
--   changes slides_get: destructive_hint
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
  -- gmail_list
  UPDATE tools t SET description = 'List recent emails from the inbox. Optionally filter by label. Returns message IDs with flattened from/to/subject/date fields plus snippet and labels.', input_schema_json = '{"type":"object","properties":{"label":{"type":"string","description":"Label to filter by (e.g., \"INBOX\", \"SENT\", \"STARRED\", \"IMPORTANT\", or custom label). Defaults to INBOX."},"max_results":{"type":"number","description":"Maximum number of messages to return (default: 10)"}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_list'
    AND md5(t.description) = 'b360e2d46834a9f24ea1138d2941ffdc'
    AND md5(t.input_schema_json::text) = '3fdd6a7160b97422a2756142ebe47bfd'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_list: expected 1 row, updated %', n; END IF;

  -- gmail_list_drafts
  UPDATE tools t SET description = 'Lists the drafts in a Gmail mailbox. Returns one entry per draft with its draft ID, the ID of the message it holds and that message''s thread ID, plus a count and a page token when more drafts remain. The draft ID is what gmail_update_draft, gmail_send_draft and gmail_delete_draft take; the message ID is what gmail_read takes to show the draft''s content. A mailbox with no drafts answers with a count of 0 and an empty list.', input_schema_json = '{"type":"object","properties":{"max_results":{"type":"number","description":"The most drafts to return in one page (default: 20, at most 500)."},"query":{"type":"string","description":"Narrows the list to drafts matching a Gmail search query, in the same syntax as gmail_search (for example \"subject:invoice\" or \"to:someone@example.com\")."},"page_token":{"type":"string","description":"The nextPageToken from an earlier call, to read the page after it."}},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_list_drafts'
    AND md5(t.description) = 'f88ae3dfe371ab2fe5c11114bdeb8269'
    AND md5(t.input_schema_json::text) = '743dcb50c658636da46fdd91a9c5bcf7'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_list_drafts: expected 1 row, updated %', n; END IF;

  -- gmail_list_filters
  UPDATE tools t SET description = 'List all Gmail filters (settings > filters) with their criteria and actions. Read-only: use it to see what automation a mailbox already applies to incoming mail, for example when triaging why a message was archived or labelled before it was seen. This connector cannot create or delete filters, and neither can a raw API call through gws_run — Google accepts only the gmail.settings.basic scope on those, which is not granted. Filters must be changed in Gmail''s own settings.', input_schema_json = '{"type":"object","properties":{},"required":[]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_list_filters'
    AND md5(t.description) = 'da543c713a3ed013a37420458d6c6c2a'
    AND md5(t.input_schema_json::text) = 'c3eec2d9667b8a1143ac36f256322808'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_list_filters: expected 1 row, updated %', n; END IF;

  -- gmail_list_labels
  UPDATE tools t SET description = 'List every label in the mailbox, system and user-created, with each label''s ID, name and type. Use this to find the label ID that gmail_label_message, gmail_update_label and gmail_delete_label need.', input_schema_json = '{"type":"object","properties":{}}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_list_labels'
    AND md5(t.description) = '6617746fa11b8743018fb87248f4bf73'
    AND md5(t.input_schema_json::text) = '6cb44a56118e2966acccfb86f18d0570'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_list_labels: expected 1 row, updated %', n; END IF;

  -- gmail_mark_read
  UPDATE tools t SET description = 'Mark one or more Gmail messages as read by removing the UNREAD label. With add_labels or remove_labels given, it applies exactly those and nothing else, so add_labels alone does not mark anything read and add_labels ["UNREAD"] marks unread. Pass message_id for a single message (returns the modified message) or message_ids for a batch (up to 1000, single API call via users.messages.batchModify).', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"A single Gmail message ID to modify. Provide either this or message_ids."},"message_ids":{"type":"array","items":{"type":"string"},"description":"Multiple Gmail message IDs to modify in one batch call (max 1000). Provide either this or message_id."},"add_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to add (e.g., [\"STARRED\", \"IMPORTANT\"]). Optional."},"remove_labels":{"type":"array","items":{"type":"string"},"description":"Label IDs to remove (e.g., [\"UNREAD\", \"INBOX\"]). Defaults to [\"UNREAD\"] if neither add_labels nor remove_labels is provided."}},"required":[]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_mark_read'
    AND md5(t.description) = '8925800f19506f3e459080cf24b078c9'
    AND md5(t.input_schema_json::text) = '1934573c52b41460bff2dc372efae81a'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_mark_read: expected 1 row, updated %', n; END IF;

  -- gmail_mark_spam
  UPDATE tools t SET description = 'Reports one Gmail message as spam. Takes the message ID. The message gets Gmail''s SPAM label and leaves the inbox, as the Report spam button does, and Gmail deletes spam for good after 30 days; gmail_unmark_spam moves it back before then. Returns the message ID, whether it is now in spam, and the labels it carries afterwards. Acts on the one message named, not on the rest of its thread.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to report as spam."}},"required":["message_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_mark_spam'
    AND md5(t.description) = '95ac4083b96b568b0dd1bb9e63d57d99'
    AND md5(t.input_schema_json::text) = '688dc10910428a819928a9a0f982da8d'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_mark_spam: expected 1 row, updated %', n; END IF;

  -- gmail_read
  UPDATE tools t SET description = 'Read a specific email message by its ID. By default returns the full message including headers, body, and metadata. Use text_only for a compact view (flattened headers, decoded text body, attachment metadata) that avoids large MIME/base64 payloads. Each attachment is listed with its part ID; gmail_get_attachment takes the message ID and that part ID and returns the attachment''s text, or describes a file that is not text.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The Gmail message ID to read"},"text_only":{"type":"boolean","description":"Return a compact view instead of the raw MIME payload: flattened from/to/cc/subject/date headers, the decoded text/plain body (falls back to tag-stripped text/html), and attachment metadata (partId, filename, mimeType, attachmentId). Recommended for triage: it avoids base64 attachment data overflowing the response."},"max_body_chars":{"type":"number","description":"Truncate the returned body text to this many characters (adds a truncation marker). Implies text_only."}},"required":["message_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_read'
    AND md5(t.description) = '681fc7372f04dcaf11bbb976627bdf3a'
    AND md5(t.input_schema_json::text) = '920747e5db5a386d959de630dde534e5'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_read: expected 1 row, updated %', n; END IF;

  -- gmail_reply
  UPDATE tools t SET description = 'Reply to an existing email in its thread. The reply is addressed the way Gmail''s own Reply does it: to the original''s Reply-To when it has one, otherwise to its sender; when you sent the original yourself, to the people it was sent to. Pass reply_all: true to include everyone else on the original as well. The response reports the To and Cc the reply went to; when a Reply-To meant the original''s sender was not among them, it also carries reply_to_used: true and original_from, so check to against who you meant to answer, or pass expected_to and the reply is refused instead of sent when it would go anywhere else. A body is required: pass body or html_body. The account''s Gmail signature is appended automatically, so do not write a sign-off or signature in the body yourself; pass signature: false to send without it. The signature goes in the message''s HTML part, so a plain-text body is sent as multipart/alternative when the account has one. The response''s signature field reports what happened.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The Gmail message ID to reply to"},"body":{"type":"string","description":"Reply body text (plain). One of body or html_body is required."},"html_body":{"type":"string","description":"HTML reply body. The reply goes out with both an HTML part and a plain-text part derived from it, and the original message is quoted beneath with Gmail styling. Provide body or html_body, not both; one of them is required."},"reply_all":{"type":"boolean","description":"Default false: the reply goes to one party, the original''s Reply-To or sender (or, for a message you sent, its recipients). Set true to reply to everyone: the original''s other To recipients are added to To and its Cc recipients to Cc, without your own addresses."},"expected_to":{"type":"string","description":"Optional guard: the address or addresses, comma separated, you mean this reply to reach. The reply is refused before anything is sent unless it would go to exactly these (every To address, and every Cc address under reply_all; order and case are ignored). Use it when it matters who receives the reply: the recipients come from the original message''s headers, and a Reply-To can name someone other than the sender you see."},"attachments":{"type":"array","maxItems":10,"description":"Files to send with the message, at most 10, 25 MB in total. Each entry is a Drive file id as a string, or {\"file_id\": \"<id>\", \"as\": \"<format>\"} to send a Google Doc, Sheet or Slides deck as a file, or a file reference. Formats: Docs pdf, docx, txt, html, md, rtf, odt, epub; Sheets pdf, xlsx, csv, tsv, html, ods; Slides pdf, pptx, txt, odp. csv and tsv export one tab: add \"tab\": \"<title>\" to choose it, otherwise the first tab goes, and the response says which. A Sheet as html arrives as a .zip of pages, one per tab; Slides as txt is the slides'' visible text only. Google Docs, Sheets and Slides passed by id alone are sent as links in the message, the way Gmail does, not as files. Other Drive files are attached as they are. A file reference is an object with a \"type\": {\"type\": \"gmail_message\", \"message_id\": \"<id>\"} attaches an email as its original .eml, {\"type\": \"gmail_attachment\", \"message_id\": \"<id>\", \"part_id\": \"<part id>\"} one attachment of an email, {\"type\": \"drive_file\", \"file_id\": \"<id>\"} a Drive file as stored, {\"type\": \"drive_export\", \"file_id\": \"<id>\", \"format\": \"pdf\"} a Google file exported, {\"type\": \"content\", \"name\": \"<file name>\", \"base64\": \"<standard base64, one unbroken string>\"} a file the caller already holds, at most 1 MB, and {\"type\": \"upload\", \"upload_id\": \"<id>\"} a file the user sent through file_upload_link. A reference may carry an \"account\" naming the connected Google account that holds the email or file. Several entries may be references. Two attachments may not share a filename. To show an image in the body rather than at the bottom, reference it in html_body as <img src=\"cid:FILENAME\">, where FILENAME is its Drive filename with any character other than letters, digits, dot, dash and underscore replaced by an underscore. Sharing a Drive link is the sender''s responsibility; nothing here changes who can open a file. The response''s attachments field reports each file as attached, inline, linked or exported, with its size and the SHA-256 of the bytes that went into the message; a file sent as a link has neither.","items":{"anyOf":[{"type":"string","description":"A Drive file id."},{"type":"object","properties":{"file_id":{"type":"string","description":"A Drive file id."},"as":{"type":"string","enum":["pdf","docx","txt","html","md","rtf","odt","epub","xlsx","csv","tsv","ods","pptx","odp"],"description":"Export a Google Doc, Sheet or Slides deck in this format."},"tab":{"type":"string","description":"For a Sheet as csv or tsv: the tab to export, by title. Defaults to the first tab."}},"required":["file_id"]},{"type":"object","description":"A file reference, resolved by the gateway and attached in this entry''s place.","properties":{"type":{"type":"string","enum":["gmail_message","gmail_attachment","drive_file","drive_export","content","upload"],"description":"The kind of file reference."},"message_id":{"type":"string","description":"With gmail_message and gmail_attachment: the Gmail message id."},"part_id":{"type":"string","description":"With gmail_attachment: the attachment''s part id as gmail_read lists it."},"file_id":{"type":"string","description":"With drive_file and drive_export: the Drive file id."},"format":{"type":"string","description":"With drive_export: the format to export to, such as pdf."},"account":{"type":"string","description":"Which connected Google account holds the email or file. Not taken with content."},"name":{"type":"string","description":"With content: the file''s name, with its extension."},"base64":{"type":"string","description":"With content: the file in standard base64 as one unbroken string, at most 1 MB decoded."},"mime_type":{"type":"string","description":"With content, optional: the file''s type; omitted, it comes from the name''s extension."},"upload_id":{"type":"string","description":"With upload: the id from the receipt of a file sent through file_upload_link."}},"required":["type"]}]}},"signature":{"type":"boolean","description":"Set false to send without the account''s Gmail signature, and to skip the lookup entirely. Defaults to true."}},"required":["message_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_reply'
    AND md5(t.description) = '2cea811918b3fd02f00450bdfcaec1d8'
    AND md5(t.input_schema_json::text) = '586c8de9a62ca452c693934774a9c514'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_reply: expected 1 row, updated %', n; END IF;

  -- gmail_save_attachment_to_drive
  UPDATE tools t SET description = 'Save a Gmail attachment directly to Google Drive. Use gmail_read first to get attachment metadata (filename, mimeType, attachmentId) from the message parts. The file is fetched from Gmail and uploaded to Drive server-side — no base64 data flows through the conversation. Returns the Drive file metadata including a web link.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The Gmail message ID that contains the attachment"},"attachment_id":{"type":"string","description":"The attachment ID from the message part''s body.attachmentId field"},"filename":{"type":"string","description":"Filename to save as in Drive (e.g., ''report.xlsx'')"},"parent_folder_id":{"type":"string","description":"Optional Drive folder ID to save into. If omitted, saves to the root of My Drive."}},"required":["message_id","attachment_id","filename"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_save_attachment_to_drive'
    AND md5(t.description) = '5148ba1b0c1498dfc31f91f73969f518'
    AND md5(t.input_schema_json::text) = '3bc9fc8b4afe5e33dc242c44635f27de'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_save_attachment_to_drive: expected 1 row, updated %', n; END IF;

  -- gmail_search
  UPDATE tools t SET description = 'Search Gmail messages using Gmail search syntax. Returns matching messages with flattened from/to/subject/date fields plus snippet and labels. Supports queries like "from:client@acme.com", "subject:proposal", "after:2024/01/01", "has:attachment", "label:important". A message''s attachments are listed by gmail_read and read by gmail_get_attachment.', input_schema_json = '{"type":"object","properties":{"query":{"type":"string","description":"Gmail search query (e.g., \"from:john@example.com subject:Q4 proposal\", \"is:unread after:2024/06/01\")"},"max_results":{"type":"number","description":"Maximum number of messages to return (default: 10)"}},"required":["query"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_search'
    AND md5(t.description) = '19dcc8211cf91488c1db98f549fd4cfe'
    AND md5(t.input_schema_json::text) = '9472dc2a1664a3ebff1ab03ab31cac3b'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_search: expected 1 row, updated %', n; END IF;

  -- gmail_send
  UPDATE tools t SET description = 'Send a new email via Gmail. Composes and sends an email message to the specified recipients. Accepts a plain-text body, an HTML html_body, or both — HTML is sent as multipart/alternative with a plain-text fallback. The account''s Gmail signature is appended automatically, so do not write a sign-off or signature in the body yourself; pass signature: false to send without it. The signature goes in the message''s HTML part, so a plain-text body is sent as multipart/alternative when the account has one. The response''s signature field reports what happened.', input_schema_json = '{"type":"object","properties":{"to":{"type":"string","description":"Recipient email address(es), comma-separated"},"subject":{"type":"string","description":"Email subject line"},"body":{"type":"string","description":"Plain-text email body. When html_body is also given, this becomes the text/plain alternative part shown by plain-text clients. One of body or html_body is required."},"html_body":{"type":"string","description":"HTML email body. The message is sent as multipart/alternative with a text/plain fallback part (body if provided, otherwise text derived from the HTML), so plain-text clients still render something readable."},"cc":{"type":"string","description":"CC recipients, comma-separated"},"bcc":{"type":"string","description":"BCC recipients, comma-separated"},"attachments":{"type":"array","maxItems":10,"description":"Files to send with the message, at most 10, 25 MB in total. Each entry is a Drive file id as a string, or {\"file_id\": \"<id>\", \"as\": \"<format>\"} to send a Google Doc, Sheet or Slides deck as a file, or a file reference. Formats: Docs pdf, docx, txt, html, md, rtf, odt, epub; Sheets pdf, xlsx, csv, tsv, html, ods; Slides pdf, pptx, txt, odp. csv and tsv export one tab: add \"tab\": \"<title>\" to choose it, otherwise the first tab goes, and the response says which. A Sheet as html arrives as a .zip of pages, one per tab; Slides as txt is the slides'' visible text only. Google Docs, Sheets and Slides passed by id alone are sent as links in the message, the way Gmail does, not as files. Other Drive files are attached as they are. A file reference is an object with a \"type\": {\"type\": \"gmail_message\", \"message_id\": \"<id>\"} attaches an email as its original .eml, {\"type\": \"gmail_attachment\", \"message_id\": \"<id>\", \"part_id\": \"<part id>\"} one attachment of an email, {\"type\": \"drive_file\", \"file_id\": \"<id>\"} a Drive file as stored, {\"type\": \"drive_export\", \"file_id\": \"<id>\", \"format\": \"pdf\"} a Google file exported, {\"type\": \"content\", \"name\": \"<file name>\", \"base64\": \"<standard base64, one unbroken string>\"} a file the caller already holds, at most 1 MB, and {\"type\": \"upload\", \"upload_id\": \"<id>\"} a file the user sent through file_upload_link. A reference may carry an \"account\" naming the connected Google account that holds the email or file. Several entries may be references. Two attachments may not share a filename. To show an image in the body rather than at the bottom, reference it in html_body as <img src=\"cid:FILENAME\">, where FILENAME is its Drive filename with any character other than letters, digits, dot, dash and underscore replaced by an underscore. Sharing a Drive link is the sender''s responsibility; nothing here changes who can open a file. The response''s attachments field reports each file as attached, inline, linked or exported, with its size and the SHA-256 of the bytes that went into the message; a file sent as a link has neither.","items":{"anyOf":[{"type":"string","description":"A Drive file id."},{"type":"object","properties":{"file_id":{"type":"string","description":"A Drive file id."},"as":{"type":"string","enum":["pdf","docx","txt","html","md","rtf","odt","epub","xlsx","csv","tsv","ods","pptx","odp"],"description":"Export a Google Doc, Sheet or Slides deck in this format."},"tab":{"type":"string","description":"For a Sheet as csv or tsv: the tab to export, by title. Defaults to the first tab."}},"required":["file_id"]},{"type":"object","description":"A file reference, resolved by the gateway and attached in this entry''s place.","properties":{"type":{"type":"string","enum":["gmail_message","gmail_attachment","drive_file","drive_export","content","upload"],"description":"The kind of file reference."},"message_id":{"type":"string","description":"With gmail_message and gmail_attachment: the Gmail message id."},"part_id":{"type":"string","description":"With gmail_attachment: the attachment''s part id as gmail_read lists it."},"file_id":{"type":"string","description":"With drive_file and drive_export: the Drive file id."},"format":{"type":"string","description":"With drive_export: the format to export to, such as pdf."},"account":{"type":"string","description":"Which connected Google account holds the email or file. Not taken with content."},"name":{"type":"string","description":"With content: the file''s name, with its extension."},"base64":{"type":"string","description":"With content: the file in standard base64 as one unbroken string, at most 1 MB decoded."},"mime_type":{"type":"string","description":"With content, optional: the file''s type; omitted, it comes from the name''s extension."},"upload_id":{"type":"string","description":"With upload: the id from the receipt of a file sent through file_upload_link."}},"required":["type"]}]}},"signature":{"type":"boolean","description":"Set false to send without the account''s Gmail signature, and to skip the lookup entirely. Defaults to true."}},"required":["to","subject"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_send'
    AND md5(t.description) = '99b8971709394047990cc07cb3449340'
    AND md5(t.input_schema_json::text) = '5e69680e1ec28402cf2751d0cff475e7'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_send: expected 1 row, updated %', n; END IF;

  -- gmail_send_draft
  UPDATE tools t SET description = 'Send an existing Gmail draft by its draft ID. Use this to send a draft that was previously created with gmail_create_draft and reviewed — it sends the draft as stored and removes it from the Drafts folder (no orphaned draft). Returns the sent message metadata. The account''s Gmail signature is added only if the draft is not already signed: a draft written by gmail_create_draft or gmail_update_draft carries it already and is sent unchanged, reporting already_present. Pass signature: false to send a draft without adding one. The response''s signature field reports what happened. A draft holding files is signed in its text part and its files are sent as they are. A draft in any other shape is sent untouched and reports skipped_unsupported_draft.', input_schema_json = '{"type":"object","properties":{"draft_id":{"type":"string","description":"The Gmail draft ID to send"},"signature":{"type":"boolean","description":"Set false to send without the account''s Gmail signature, and to skip the lookup entirely. Defaults to true."}},"required":["draft_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_send_draft'
    AND md5(t.description) = '02e998b7d1e297407d486e8c785df41c'
    AND md5(t.input_schema_json::text) = 'd542748ec3f84a8cabaf672bd275de1a'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_send_draft: expected 1 row, updated %', n; END IF;

  -- gmail_trash
  UPDATE tools t SET description = 'Moves one Gmail message to Trash. Takes the message ID. The message leaves the inbox and every other label view and stays in Trash, where Gmail deletes it for good after 30 days; gmail_untrash restores it before then. Returns the message ID and the labels the message carries afterwards. Acts on the one message named, not on the rest of its thread.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to move to Trash, as gmail_search, gmail_list and gmail_read return it."}},"required":["message_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_trash'
    AND md5(t.description) = '2c3c6f817d9da4b1fef95ce814339e67'
    AND md5(t.input_schema_json::text) = '31b2dd158bd82c7fdcb0787974c646bb'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_trash: expected 1 row, updated %', n; END IF;

  -- gmail_trash_thread
  UPDATE tools t SET description = 'Moves a whole Gmail conversation to Trash: every message in the thread, in one call. Takes the thread ID. The messages leave the inbox and every other label view and stay in Trash, where Gmail deletes them for good after 30 days; gmail_untrash_thread restores them before then. Returns the thread ID and, for each message in it, the message ID and whether it is now in Trash.', input_schema_json = '{"type":"object","properties":{"thread_id":{"type":"string","description":"The ID of the thread to move to Trash, as gmail_search, gmail_list and gmail_read return it (threadId)."}},"required":["thread_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_trash_thread'
    AND md5(t.description) = '103a79e2faf1f9e60a1d668c49e994d7'
    AND md5(t.input_schema_json::text) = '3cfd96984c481cda1145e49284164139'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_trash_thread: expected 1 row, updated %', n; END IF;

  -- gmail_unmark_spam
  UPDATE tools t SET description = 'Moves one Gmail message out of spam and back to the inbox, as the Not spam button does. Takes the message ID. Returns the message ID, whether it is still in spam, and the labels it carries afterwards.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to move out of spam."}},"required":["message_id"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_unmark_spam'
    AND md5(t.description) = '4d70d3a1d31d81944d548f856c17a754'
    AND md5(t.input_schema_json::text) = '8521957539965429dc79fcef4a2cb026'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_unmark_spam: expected 1 row, updated %', n; END IF;

  -- gmail_untrash
  UPDATE tools t SET description = 'Takes one Gmail message out of Trash. Takes the message ID. Returns the message ID and the labels the message carries afterwards. A message Gmail has already deleted from Trash is gone and answers as not found.', input_schema_json = '{"type":"object","properties":{"message_id":{"type":"string","description":"The ID of the message to take out of Trash."}},"required":["message_id"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_untrash'
    AND md5(t.description) = '38f41a9eb4081bd6107b542504ab152c'
    AND md5(t.input_schema_json::text) = 'fc9255105961b41f984c7f6973e7c75c'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_untrash: expected 1 row, updated %', n; END IF;

  -- gmail_untrash_thread
  UPDATE tools t SET description = 'Takes a whole Gmail conversation out of Trash: every message in the thread, in one call. Takes the thread ID. Returns the thread ID and, for each message in it, the message ID and whether it is still in Trash. Messages Gmail has already deleted from Trash are gone and are not in the answer.', input_schema_json = '{"type":"object","properties":{"thread_id":{"type":"string","description":"The ID of the thread to take out of Trash."}},"required":["thread_id"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_untrash_thread'
    AND md5(t.description) = 'ffeda09f3ce1f8d58cd71fe46d00d28c'
    AND md5(t.input_schema_json::text) = '635931ace70c7223bfb8f5093599d7de'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_untrash_thread: expected 1 row, updated %', n; END IF;

  -- gmail_update_draft
  UPDATE tools t SET description = 'Update an existing draft email in Gmail. This fully replaces the draft''s message content (Gmail API does not support partial edits), attachments included: files the draft held, including any attached by a file reference, are dropped unless they are passed again in attachments. If thread_id is omitted, the tool preserves the existing thread automatically. The account''s Gmail signature is added to the draft automatically, as Gmail''s own Compose does, so do not write a sign-off or signature in the body yourself; pass signature: false to leave it out. The signature goes in the draft''s HTML part, so a plain-text body is stored as multipart/alternative when the account has one. The response''s signature field reports what happened.', input_schema_json = '{"type":"object","properties":{"draft_id":{"type":"string","description":"The Gmail draft ID to update"},"to":{"type":"string","description":"Recipient email address(es), comma-separated"},"subject":{"type":"string","description":"Email subject line"},"body":{"type":"string","description":"Plain-text email body. When html_body is also given, this becomes the text/plain alternative part shown by plain-text clients. One of body or html_body is required."},"html_body":{"type":"string","description":"HTML email body. The message is sent as multipart/alternative with a text/plain fallback part (body if provided, otherwise text derived from the HTML), so plain-text clients still render something readable."},"cc":{"type":"string","description":"CC recipients, comma-separated"},"bcc":{"type":"string","description":"BCC recipients, comma-separated"},"thread_id":{"type":"string","description":"Thread ID to preserve threading. If omitted, the existing draft''s thread is preserved automatically."},"attachments":{"type":"array","maxItems":10,"description":"Files to send with the message, at most 10, 25 MB in total. Each entry is a Drive file id as a string, or {\"file_id\": \"<id>\", \"as\": \"<format>\"} to send a Google Doc, Sheet or Slides deck as a file, or a file reference. Formats: Docs pdf, docx, txt, html, md, rtf, odt, epub; Sheets pdf, xlsx, csv, tsv, html, ods; Slides pdf, pptx, txt, odp. csv and tsv export one tab: add \"tab\": \"<title>\" to choose it, otherwise the first tab goes, and the response says which. A Sheet as html arrives as a .zip of pages, one per tab; Slides as txt is the slides'' visible text only. Google Docs, Sheets and Slides passed by id alone are sent as links in the message, the way Gmail does, not as files. Other Drive files are attached as they are. A file reference is an object with a \"type\": {\"type\": \"gmail_message\", \"message_id\": \"<id>\"} attaches an email as its original .eml, {\"type\": \"gmail_attachment\", \"message_id\": \"<id>\", \"part_id\": \"<part id>\"} one attachment of an email, {\"type\": \"drive_file\", \"file_id\": \"<id>\"} a Drive file as stored, {\"type\": \"drive_export\", \"file_id\": \"<id>\", \"format\": \"pdf\"} a Google file exported, {\"type\": \"content\", \"name\": \"<file name>\", \"base64\": \"<standard base64, one unbroken string>\"} a file the caller already holds, at most 1 MB, and {\"type\": \"upload\", \"upload_id\": \"<id>\"} a file the user sent through file_upload_link. A reference may carry an \"account\" naming the connected Google account that holds the email or file. Several entries may be references. Two attachments may not share a filename. To show an image in the body rather than at the bottom, reference it in html_body as <img src=\"cid:FILENAME\">, where FILENAME is its Drive filename with any character other than letters, digits, dot, dash and underscore replaced by an underscore. Sharing a Drive link is the sender''s responsibility; nothing here changes who can open a file. The response''s attachments field reports each file as attached, inline, linked or exported, with its size and the SHA-256 of the bytes that went into the message; a file sent as a link has neither.","items":{"anyOf":[{"type":"string","description":"A Drive file id."},{"type":"object","properties":{"file_id":{"type":"string","description":"A Drive file id."},"as":{"type":"string","enum":["pdf","docx","txt","html","md","rtf","odt","epub","xlsx","csv","tsv","ods","pptx","odp"],"description":"Export a Google Doc, Sheet or Slides deck in this format."},"tab":{"type":"string","description":"For a Sheet as csv or tsv: the tab to export, by title. Defaults to the first tab."}},"required":["file_id"]},{"type":"object","description":"A file reference, resolved by the gateway and attached in this entry''s place.","properties":{"type":{"type":"string","enum":["gmail_message","gmail_attachment","drive_file","drive_export","content","upload"],"description":"The kind of file reference."},"message_id":{"type":"string","description":"With gmail_message and gmail_attachment: the Gmail message id."},"part_id":{"type":"string","description":"With gmail_attachment: the attachment''s part id as gmail_read lists it."},"file_id":{"type":"string","description":"With drive_file and drive_export: the Drive file id."},"format":{"type":"string","description":"With drive_export: the format to export to, such as pdf."},"account":{"type":"string","description":"Which connected Google account holds the email or file. Not taken with content."},"name":{"type":"string","description":"With content: the file''s name, with its extension."},"base64":{"type":"string","description":"With content: the file in standard base64 as one unbroken string, at most 1 MB decoded."},"mime_type":{"type":"string","description":"With content, optional: the file''s type; omitted, it comes from the name''s extension."},"upload_id":{"type":"string","description":"With upload: the id from the receipt of a file sent through file_upload_link."}},"required":["type"]}]}},"signature":{"type":"boolean","description":"Set false to write the draft without the account''s Gmail signature, and to skip the lookup entirely. Defaults to true."}},"required":["draft_id","to","subject"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_update_draft'
    AND md5(t.description) = '502568c9707129227b66b7f1b23a7c3b'
    AND md5(t.input_schema_json::text) = '3c77a92d3ee3d02eb46f349aa15f5bec'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_update_draft: expected 1 row, updated %', n; END IF;

  -- gmail_update_label
  UPDATE tools t SET description = 'Rename an existing Gmail label, or change its visibility. Takes the label ID (from gmail_list_labels), not the label name. Renaming a label keeps it on every message already labelled with it.', input_schema_json = '{"type":"object","properties":{"label_id":{"type":"string","description":"The label ID to update (from gmail_list_labels)"},"name":{"type":"string","description":"New label name. Nested labels use ''/'' (e.g. ''Alerts/Invoices'')"},"label_list_visibility":{"type":"string","description":"Whether the label shows in the label list: labelShow, labelShowIfUnread, or labelHide"},"message_list_visibility":{"type":"string","description":"Whether the label shows on messages in the message list: show or hide"}},"required":["label_id"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gmail_update_label'
    AND md5(t.description) = '3d02f7635017bfd307dc9fc87a60273a'
    AND md5(t.input_schema_json::text) = '29344a85472426be8f496584ef89d337'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gmail_update_label: expected 1 row, updated %', n; END IF;

  -- gws_run
  UPDATE tools t SET description = 'A custom query tool for the Google Workspace REST APIs: sends one request to one API method and returns the API''s own JSON response. It reaches the methods of eight APIs, named here as Google''s reference names them: Gmail (gmail), Calendar (calendar), Drive (drive), Sheets (sheets), Docs (docs), Slides (slides), People (people) and Tasks (tasks). A call is a service, a resource path and a method, as listed under each API''s REST reference at https://developers.google.com/workspace, plus the method''s query parameters and, for a method that takes one, a JSON request body. It reaches methods that have no dedicated gmail_, calendar_, drive_, sheets_, docs_, slides_, contacts_ or tasks_ tool, with the access the connected account granted. A service, resource or method outside those eight APIs is refused before any request is sent. A response over 900 KB is cut at that size.', input_schema_json = '{"type":"object","properties":{"service":{"type":"string","description":"The API to call: one of gmail, calendar, drive, sheets, docs, slides, people, tasks."},"resource":{"type":"string","description":"The API resource, as a dotted path matching the API''s REST structure. Gmail''s resources sit under users (users.messages, users.drafts, users.labels, users.messages.attachments); Sheets has spreadsheets, spreadsheets.values and spreadsheets.sheets; top-level examples are events and calendarList (calendar) and files (drive)."},"method":{"type":"string","description":"API method (e.g., list, get, create, update, delete)"},"params":{"type":"object","description":"Query parameters as key-value pairs (e.g., { pageSize: 10, q: \"search query\" })"},"json_body":{"type":"object","description":"Request body for create/update operations (alias: body)"},"body":{"type":"object","x-alias-of":"json_body","description":"Request body for create/update operations (alias for json_body)"},"page_all":{"type":"boolean","description":"Fetch all pages of results (default: false, max 10 pages)"},"dry_run":{"type":"boolean","description":"Preview the request without executing it"}},"required":["service","resource","method"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'gws_run'
    AND md5(t.description) = '053451effbd8e3e31a8c71baad93c971'
    AND md5(t.input_schema_json::text) = '39fd16be461b760648d9079c40a53b5f'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward gws_run: expected 1 row, updated %', n; END IF;

  -- sheets_add_tab
  UPDATE tools t SET description = 'Add a new tab (sheet) to an existing Google Sheets spreadsheet. Use sheets_create to make a whole new spreadsheet file; use this to add a tab inside one. Returns the new tab''s sheetId and title.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"title":{"type":"string","description":"Title for the new tab"},"headers":{"type":"array","items":{"type":"string"},"description":"Optional header row values written to row 1 of the new tab, e.g., [\"Name\", \"Email\", \"Date\"]"}},"required":["spreadsheet_id","title"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_add_tab'
    AND md5(t.description) = 'b8f7aa9d30e612f5b4ba6637a8165f23'
    AND md5(t.input_schema_json::text) = 'cc9272a87961e118c8837b13a361de3b'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_add_tab: expected 1 row, updated %', n; END IF;

  -- sheets_append
  UPDATE tools t SET description = 'Append rows to the end of a Google Sheets spreadsheet. Numeric-looking text is typed the way the Sheets UI types it: ''007'' is stored as the number 7 and comes back as 7. To keep such a value as text, pass value_input_option RAW for the call, or put a leading apostrophe on that one value.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"values":{"type":"array","items":{"type":"array","items":{"type":"string"}},"description":"2D array of rows to append, e.g., [[\"val1\",\"val2\"],[\"val3\",\"val4\"]]"},"range":{"type":"string","description":"Target range naming the tab to append to, e.g. \"TabName!A1\". When omitted, \"Sheet1!A1\" is sent, which only works while the spreadsheet still has a tab literally named Sheet1 — pass the range explicitly otherwise."},"parse_formulas":{"type":"boolean","description":"Allow values to be stored as live formulas. Default false, which writes a leading = or + literally. Only set true when the caller explicitly asked for a formula — never for text taken from email, documents, or the web."},"value_input_option":{"type":"string","enum":["USER_ENTERED","RAW"],"description":"How Sheets interprets the values. USER_ENTERED (default) parses numbers, dates and booleans as typing them would, with formula-prefixed text kept inert unless parse_formulas is set. RAW stores every value verbatim as text: formulas never evaluate, but numbers arrive as text and break SUM/charts — use it only when literal-text semantics are the point."}},"required":["spreadsheet_id","values"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_append'
    AND md5(t.description) = '43f8538e9520f56195411bfa5c44c452'
    AND md5(t.input_schema_json::text) = '12bcd5ab80340eb509b9a31cc8a74ef4'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_append: expected 1 row, updated %', n; END IF;

  -- sheets_batch_update
  UPDATE tools t SET description = 'Apply a batch of structural and formatting changes to a spreadsheet, in ONE atomic call. This is the full Google Sheets batchUpdate pass-through and the escape hatch beneath the job-shaped tools: reach for sheets_format_range or sheets_format_table first, and come here for anything they do not cover (merges, borders, banding, copyPaste, inserting or deleting COLUMNS, duplicateSheet, protected ranges). TWO PROPERTIES THAT BITE. (1) Ranges here are a GridRange, which is 0-BASED and END-EXCLUSIVE: spreadsheet row 7 is startRowIndex 6, endRowIndex 7. That is the opposite convention from the A1 notation used to write the values. (2) The batch is ATOMIC: if one request is rejected the whole batch applies nothing, and the error names the failing request''s index. Build the whole pass as one batch, fix the named index, re-send the whole thing. Note that empty reply objects are normal for formatting requests and mean ACCEPTED, not applied to what you meant.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"requests":{"type":"array","description":"Array of Sheets API batchUpdate request objects, applied in order. Common ones: updateSheetProperties (freeze rows, hide gridlines, tab colour), updateDimensionProperties (column width, row height), insertDimension and deleteDimension (add or remove rows and columns, and these SHIFT every index after them, so put them first), repeatCell (fonts, colour, wrap, alignment, number format), mergeCells, updateBorders, copyPaste, duplicateSheet. Example: [{ \"updateDimensionProperties\": { \"range\": { \"sheetId\": 0, \"dimension\": \"COLUMNS\", \"startIndex\": 1, \"endIndex\": 4 }, \"properties\": { \"pixelSize\": 400 }, \"fields\": \"pixelSize\" } }]","items":{"type":"object"}}},"required":["spreadsheet_id","requests"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_batch_update'
    AND md5(t.description) = 'd13c706c6ffa40535bc2d295159d5cde'
    AND md5(t.input_schema_json::text) = '52360b03c2ba39270280b793d3d460d7'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_batch_update: expected 1 row, updated %', n; END IF;

  -- sheets_clear
  UPDATE tools t SET description = 'Clear the values in a range, leaving the tab and its formatting in place. This is the non-destructive way to empty a tab or a block of cells — use it instead of deleting and recreating a tab, which throws away the tab''s structure along with its data.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"range":{"type":"string","description":"Range to clear in A1 notation. A bare tab name clears the whole tab (e.g. \"Inventory\"), or clear a block with \"Inventory!A2:D\""}},"required":["spreadsheet_id","range"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_clear'
    AND md5(t.description) = 'ba6f88ac584feca6db327668d7f022a1'
    AND md5(t.input_schema_json::text) = 'ea3d035d9290f106a2950d4bba5f3e29'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_clear: expected 1 row, updated %', n; END IF;

  -- sheets_copy_tab_to
  UPDATE tools t SET description = 'Copies one tab of a Google Sheets spreadsheet into another spreadsheet. Takes the source spreadsheet ID, the title of the tab to copy and the destination spreadsheet ID. The copy carries the tab''s values, formulas and formatting and is added to the destination as a new tab, which Google names "Copy of <title>"; nothing already in the destination is changed, and the source is left as it was. Returns the new tab''s sheetId, title and position in the destination. The account needs edit access to the destination.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The ID of the spreadsheet that holds the tab to copy"},"title":{"type":"string","description":"Title of the tab to copy, as sheets_get_metadata lists it"},"destination_spreadsheet_id":{"type":"string","description":"The ID of the spreadsheet the copy is added to"}},"required":["spreadsheet_id","title","destination_spreadsheet_id"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_copy_tab_to'
    AND md5(t.description) = '95989edbf2d3ced25e22d8c0b16f8e5b'
    AND md5(t.input_schema_json::text) = '146c8c4f93089b7875062e296c5376eb'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_copy_tab_to: expected 1 row, updated %', n; END IF;

  -- sheets_create
  UPDATE tools t SET description = 'Create a new Google Sheets spreadsheet.', input_schema_json = '{"type":"object","properties":{"title":{"type":"string","description":"Title for the new spreadsheet"},"headers":{"type":"array","items":{"type":"string"},"description":"Optional header row values, e.g., [\"Name\", \"Email\", \"Date\"]"}},"required":["title"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_create'
    AND md5(t.description) = '84941e557e5f36c67b6c9caf9c5e34dc'
    AND md5(t.input_schema_json::text) = 'ebb79acd6b2efe997ed67b69bfe3be42'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_create: expected 1 row, updated %', n; END IF;

  -- sheets_delete
  UPDATE tools t SET description = 'Delete a Google Sheets spreadsheet. This permanently removes the file from Drive.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID to delete"}},"required":["spreadsheet_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_delete'
    AND md5(t.description) = '76e9b685a42f65768e4613d72ec20ef2'
    AND md5(t.input_schema_json::text) = 'cfe4a074491501b2b5a9121ea642a32d'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_delete: expected 1 row, updated %', n; END IF;

  -- sheets_delete_tab
  UPDATE tools t SET description = 'Delete a tab (sheet) and everything in it from a spreadsheet. Takes the tab''s current title. THIS DESTROYS EVERY ROW IN THE TAB and cannot be undone through the API. To empty a tab without losing it, use sheets_clear instead. To delete the whole spreadsheet file, use sheets_delete.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"title":{"type":"string","description":"Title of the tab to delete, with all of its rows"}},"required":["spreadsheet_id","title"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_delete_tab'
    AND md5(t.description) = 'b7a6cffd0194af96db0813d0de2e81ad'
    AND md5(t.input_schema_json::text) = '45d2c1452db86a3b2a71b56b0f7c7a8d'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_delete_tab: expected 1 row, updated %', n; END IF;

  -- sheets_find_rows
  UPDATE tools t SET description = 'Find the rows in a spreadsheet range whose value in one column matches what you are looking for, and get back their ROW NUMBERS. Use this instead of reading a whole sheet and filtering the values yourself: on any real sheet that burns context on rows nobody asked for. Searches MANY values in a single call, so looking up twenty customers is one call and not twenty. Each match comes back with its 1-based sheet row number and a ready-made A1 range for that row, which is what lets a find be followed directly by a sheets_update. Values that matched nothing are listed separately, so an empty result cannot be mistaken for a broken call.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"range":{"type":"string","description":"The range to search: a tab name on its own searches that whole tab (the simplest correct call), or A1 notation naming a real tab, e.g. \"TabName!A:D\" for whole columns or \"TabName!A1:D500\" for a block — TabName stands for a tab the spreadsheet actually has. Row numbers in the result are absolute sheet rows, so a range starting at A10 reports its first data row as 11."},"column":{"type":"string","description":"Which column to match on: a header name taken from the first row of the range (\"Email\"), or an A1 column letter (\"B\")."},"values":{"type":"array","items":{"type":"string"},"description":"The values to look for. Pass every value you need in ONE call, e.g. [\"ana@example.com\", \"bo@example.com\"]."},"query":{"type":"string","x-alias-of":"values","description":"One value to look for, taken as values with that single value. Give values or query, not both. The answer names it under aliased."},"match":{"type":"string","enum":["exact","contains","prefix"],"description":"\"exact\" (default) compares the whole cell, case-sensitively, after trimming both sides. \"contains\" and \"prefix\" are substring tests and are case-INsensitive. Exact is the default because a lookup that quietly folded case would make two different rows interchangeable without ever saying so."},"has_header_row":{"type":"boolean","description":"Default true: the first row of the range is headers, is used to resolve a column name, and is never returned as a match. Set false when the range is pure data."},"max_results":{"type":"number","description":"Maximum matching rows returned per searched value. Default 50. A capped result says truncated: true, because a silent truncation reads exactly like a complete answer."}},"required":["spreadsheet_id","range","column","values"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_find_rows'
    AND md5(t.description) = 'd4b6ed9b45534bf41206558fbef467f4'
    AND md5(t.input_schema_json::text) = '64d43676b89e0a757dac54c35c8fcb7d'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_find_rows: expected 1 row, updated %', n; END IF;

  -- sheets_format_range
  UPDATE tools t SET description = 'Set fonts, colours, wrapping, alignment, padding, number formats and merges on spreadsheet cells. Takes a LIST of formatting instructions and applies all of them in one atomic call, so a whole formatting pass is one tool call rather than one call per range. Colours are ordinary hex (#RRGGBB) and are converted for you. Only the properties you actually set are touched; anything you leave out keeps whatever the cell already had. If you want a table to simply look readable, use sheets_format_table instead, which does the whole standard pass. For anything not covered here (borders, banding, protected ranges) use sheets_batch_update.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"formats":{"type":"array","items":{"type":"object"},"description":"One or more formatting instructions, each applied to one or more ranges. Every field except \"ranges\" is optional and only the ones you set are changed. Fields: ranges (array of A1 strings, required, e.g. [\"TabName!A1:D1\", \"TabName!A20:D20\"]), bold (boolean), italic (boolean), strikethrough (boolean), font_family (string, e.g. \"Inter\"), font_size (number), text_color (\"#RRGGBB\"), background_color (\"#RRGGBB\"), horizontal_align (LEFT|CENTER|RIGHT), vertical_align (TOP|MIDDLE|BOTTOM), wrap (OVERFLOW|CLIP|WRAP), number_format (a pattern string such as \"#,##0.00\", \"yyyy-mm-dd\" or \"0.0%\"), padding ({top,right,bottom,left} in pixels), merge (boolean, merges each named range into a single cell). Example: [{\"ranges\":[\"TabName!A1:D1\"],\"bold\":true,\"background_color\":\"#F1F1F1\"},{\"ranges\":[\"TabName!A2:D99\"],\"wrap\":\"WRAP\"}]"}},"required":["spreadsheet_id","formats"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_format_range'
    AND md5(t.description) = '8a959a659f33c5354a4a2f1ff05e3958'
    AND md5(t.input_schema_json::text) = 'ed9e4aaa61b97e1b00c0d8cb338a65d6'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_format_range: expected 1 row, updated %', n; END IF;

  -- sheets_format_table
  UPDATE tools t SET description = 'Make a spreadsheet table readable in one call: column widths, wrapped and top-aligned cells, a styled and frozen header row, and hairline borders. This is the pass to run on ANY sheet a person is going to open. Values written through sheets_update and sheets_append carry no formatting at all, and the untouched default is columns 100px wide with every long cell truncated to a slit, so a sheet with entirely correct data is routinely unreadable and the reader never learns there was more text. Applies everything as one atomic batch. Use sheets_format_range for specific styling on top, or instead of this when you do not want the whole opinionated pass.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"range":{"type":"string","description":"The table: a bare tab name for the whole tab, or A1 notation like \"TabName!A1:E60\" naming a tab the spreadsheet actually has. Include the header row."},"header_rows":{"type":"number","description":"How many rows at the top of the range are headers. Default 1. Use 0 for a table with no header, which skips both the header styling and the freeze."},"freeze_header":{"type":"boolean","description":"Default true: keep the header rows visible while scrolling. Only rows are ever frozen, never columns, because a frozen column makes merging across it illegal and would take an entire later batch down with it."},"column_widths":{"type":"array","items":{"type":"number"},"description":"Pixel widths, left to right, e.g. [250, 400, 400]. Columns you do not name get default_width. This is the single highest-value change on any sheet with prose in it."},"default_width":{"type":"number","description":"Width for columns not named in column_widths. Default 200."},"wrap":{"type":"boolean","description":"Default true: wrap and top-align the body so rows grow to fit their content. Row heights are deliberately never set, because a fixed height overrides auto-fit and re-clips the text wrapping just unclipped."},"banded":{"type":"boolean","description":"Default false. Tint alternating body rows."},"trim_grid":{"type":"boolean","description":"Default false. DELETES the rows and columns outside the range, which is what makes a sheet look authored rather than dumped. Destructive and opt-in, and it needs a fully bounded range so there is an end to trim from."}},"required":["spreadsheet_id","range"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_format_table'
    AND md5(t.description) = '864e879f0300e404750199092c61ee1d'
    AND md5(t.input_schema_json::text) = '150b5ecf67737070e4380b9fa90f2736'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_format_table: expected 1 row, updated %', n; END IF;

  -- sheets_get_metadata
  UPDATE tools t SET description = 'Describes the structure of a Google Sheets spreadsheet without reading any cell. Takes the spreadsheet ID. Returns the spreadsheet''s title, locale, time zone and link, and one entry per tab in tab order: its title, its numeric sheetId, its position, its type, whether it is hidden, its grid size in rows and columns, and how many rows and columns are frozen. The title is what range arguments name a tab by; the sheetId is what sheets_batch_update requests address a tab by. Cell values, formulas and formatting are not part of the response at any spreadsheet size.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID (from the URL)"}},"required":["spreadsheet_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_get_metadata'
    AND md5(t.description) = '0a631ac97465342b8e1d8ebaee950278'
    AND md5(t.input_schema_json::text) = 'a87f737676265fd2c5c832c3f2e26895'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_get_metadata: expected 1 row, updated %', n; END IF;

  -- sheets_query
  UPDATE tools t SET description = 'Run a query in the Google Sheets QUERY() language over a spreadsheet range and get back only the matching rows, in ONE call. Use this instead of reading a whole tab and filtering the values yourself: select A, D where I = ''open'' order by A desc limit 20 returns the twenty rows you wanted and nothing else. The language supports select, where, group by, pivot, order by, limit, offset, label and format, with count, sum, avg, min and max. Columns are addressed by their SHEET letter (A, B, C), the same letter the column has in the tab, not its position inside the range; Col1-style names are also accepted and mapped to the range''s columns in order (on Tab!C1:F500, Col1 is C). Text values are compared with quotes: where B = ''high'' or where B contains ''urgent''. A column that mixes numbers and text is read as whichever type most of its cells hold, and the cells of the other type come back empty: that is the query endpoint''s own rule and cannot be turned off, so read such a column with sheets_read or sheets_find_rows instead. Read-only: nothing in the spreadsheet changes. The result carries the header the query produced, the rows, the row count and the echoed query; an empty match is an empty rows array.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"query":{"type":"string","description":"The query, in the QUERY() language, e.g. \"select A, C, F where F = ''open'' and C > 3 order by C desc\" or \"select B, count(A) group by B\". Columns by sheet letter; strings in single quotes."},"range":{"type":"string","description":"What the query runs over: a tab name on its own queries that whole tab (the simplest correct call), or A1 notation naming a real tab, e.g. \"TabName!A1:F500\". A bare word that is the name of a tab is that tab, even when it also reads as a cell (\"Q3\", \"Log\"). A tab that does not exist is refused with the list of tabs. Omitted, the first tab is queried."},"has_header_row":{"type":"boolean","description":"Default true: the first row of the range is headers, so the result names its columns by those headers and the header row is never returned as data. Set false when the range is pure data; columns are then named by letter."}},"required":["spreadsheet_id","query"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_query'
    AND md5(t.description) = '9b7d89730232aefaff5058e745b013a0'
    AND md5(t.input_schema_json::text) = '9935e5dfedd7706e720eaaea8bc3a8e3'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_query: expected 1 row, updated %', n; END IF;

  -- sheets_read
  UPDATE tools t SET description = 'Read data from a Google Sheets spreadsheet. Returns cell values for one range, or for many ranges in one call: pass range for one block, or ranges for several blocks returned in the order given, each with the range the API echoed back.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID (from the URL)"},"range":{"type":"string","description":"Cell range in A1 notation: \"TabName!A1:D10\" scoped to a tab the spreadsheet actually has, \"A1:Z\" for the first tab, or a bare tab name for a whole tab. Give range or ranges, not both."},"ranges":{"type":"array","items":{"type":"string"},"description":"Several A1 ranges read in one request, e.g. [\"Sheet1!A1:D1\", \"Sheet1!A2:D50\", \"Totals!A1:B5\"]. The response carries one block per range, in this order, each with rowCount, columnCount and values. Use this instead of several sheets_read calls. Give range or ranges, not both."},"value_render_option":{"type":"string","enum":["FORMATTED_VALUE","UNFORMATTED_VALUE","FORMULA"],"description":"How values are rendered. FORMATTED_VALUE (default) returns what the cell displays. UNFORMATTED_VALUE returns the underlying typed value, which is how you tell a stored number from stored text. FORMULA returns the cell''s formula where it has one — the only way to tell a live formula from text that merely looks like one, so use it to verify a write."}},"required":["spreadsheet_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_read'
    AND md5(t.description) = 'eae22d398d5debbf0ec2d4994686e16a'
    AND md5(t.input_schema_json::text) = 'ebb0b95ed02f5ae60abe0442c641e320'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_read: expected 1 row, updated %', n; END IF;

  -- sheets_rename_tab
  UPDATE tools t SET description = 'Rename a tab (sheet) inside a Google Sheets spreadsheet. Takes the tab''s current title, not its sheetId. Renaming changes only the label: every row, formula and value in the tab is untouched. Ranges that name the old title will stop resolving, so update any saved ranges afterwards.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"title":{"type":"string","description":"Current title of the tab to rename"},"new_title":{"type":"string","description":"New title for the tab"}},"required":["spreadsheet_id","title","new_title"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_rename_tab'
    AND md5(t.description) = 'a7c5cf650affab9300dbba5a2a458bd7'
    AND md5(t.input_schema_json::text) = '273b09fb5f3042d250761bf1419fe9f2'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_rename_tab: expected 1 row, updated %', n; END IF;

  -- sheets_update
  UPDATE tools t SET description = 'Update specific cells in a Google Sheets spreadsheet. Overwrites existing values in the specified range. Numeric-looking text is typed the way the Sheets UI types it: ''007'' is stored as the number 7 and comes back as 7. To keep such a value as text, pass value_input_option RAW for the call, or put a leading apostrophe on that one value.', input_schema_json = '{"type":"object","properties":{"spreadsheet_id":{"type":"string","description":"The spreadsheet ID"},"range":{"type":"string","description":"Cell range in A1 notation, e.g. \"TabName!A1:B2\" — use a tab name the spreadsheet actually has."},"values":{"type":"array","items":{"type":"array","items":{"type":"string"}},"description":"2D array of values to write (rows of columns), e.g., [[\"A1\",\"B1\"],[\"A2\",\"B2\"]]"},"parse_formulas":{"type":"boolean","description":"Allow values to be stored as live formulas. Default false, which writes a leading = or + literally. Only set true when the caller explicitly asked for a formula — never for text taken from email, documents, or the web."},"value_input_option":{"type":"string","enum":["USER_ENTERED","RAW"],"description":"How Sheets interprets the values. USER_ENTERED (default) parses numbers, dates and booleans as typing them would, with formula-prefixed text kept inert unless parse_formulas is set. RAW stores every value verbatim as text: formulas never evaluate, but numbers arrive as text and break SUM/charts — use it only when literal-text semantics are the point."}},"required":["spreadsheet_id","range","values"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'sheets_update'
    AND md5(t.description) = 'ea7fa2ce600ad936cdfc72689eec91ed'
    AND md5(t.input_schema_json::text) = '797e15c8dba9e5911d7cbe5a33da6f4b'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward sheets_update: expected 1 row, updated %', n; END IF;

  -- slides_batch_update
  UPDATE tools t SET description = 'Apply batch updates to a Google Slides presentation. Supports inserting text, replacing text, creating slides, deleting objects, and other modifications. Uses the Google Slides API batchUpdate format.', input_schema_json = '{"type":"object","properties":{"presentation_id":{"type":"string","description":"The presentation ID"},"requests":{"type":"array","description":"Array of update request objects. Examples: createSlide ({ createSlide: { slideLayoutReference: { predefinedLayout: \"TITLE_AND_BODY\" } } }), insertText ({ insertText: { objectId: \"slideId\", text: \"Hello\", insertionIndex: 0 } }), replaceAllText ({ replaceAllText: { containsText: { text: \"old\" }, replaceText: \"new\" } }), deleteObject ({ deleteObject: { objectId: \"elementId\" } })","items":{"type":"object"}}},"required":["presentation_id","requests"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'slides_batch_update'
    AND md5(t.description) = 'f092f29577482a693d2ed190e8fac695'
    AND md5(t.input_schema_json::text) = '6a43ee44dd861eaa920f19c03051389b'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slides_batch_update: expected 1 row, updated %', n; END IF;

  -- slides_create
  UPDATE tools t SET description = 'Create a new Google Slides presentation. Returns the presentationId and a placeholder_map for each slide mapping placeholder types (TITLE, BODY, SUBTITLE) to their objectIds — use these with slides_batch_update insertText.', input_schema_json = '{"type":"object","properties":{"title":{"type":"string","description":"Title for the new presentation"}},"required":["title"]}'::jsonb, read_only_hint = false, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'slides_create'
    AND md5(t.description) = 'b44cc1501bc5a362b2da73466213a2f2'
    AND md5(t.input_schema_json::text) = '2ba7194a777818a681b317ec7a9837eb'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slides_create: expected 1 row, updated %', n; END IF;

  -- slides_delete
  UPDATE tools t SET description = 'Delete a Google Slides presentation. This permanently removes the file from Drive.', input_schema_json = '{"type":"object","properties":{"presentation_id":{"type":"string","description":"The presentation ID to delete"}},"required":["presentation_id"]}'::jsonb, read_only_hint = false, destructive_hint = true, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'slides_delete'
    AND md5(t.description) = '1c438d78246b8fa141bb3a6c7237c882'
    AND md5(t.input_schema_json::text) = 'f8f6a42e3005b9923f88e90ca054656a'
    AND t.read_only_hint IS NOT DISTINCT FROM false
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slides_delete: expected 1 row, updated %', n; END IF;

  -- slides_get
  UPDATE tools t SET description = 'Get the content of a Google Slides presentation. Returns slide objectIds, placeholder types (TITLE/BODY/SUBTITLE), and text content — stripped of layout/styling data to fit context windows. Use the returned objectIds with slides_batch_update for edits.', input_schema_json = '{"type":"object","properties":{"presentation_id":{"type":"string","description":"The Google Slides presentation ID (from the URL)"}},"required":["presentation_id"]}'::jsonb, read_only_hint = true, destructive_hint = false, updated_at = now()
  FROM mcp_servers s
  WHERE s.id = t.mcp_server_id AND s.slug = 'gws-mcp' AND t.name = 'slides_get'
    AND md5(t.description) = '9a0783bf259222402d236e3c460be061'
    AND md5(t.input_schema_json::text) = '1ffc40b4ddb8dc7a3d7699bb8e5a8c18'
    AND t.read_only_hint IS NOT DISTINCT FROM true
    AND t.destructive_hint IS NOT DISTINCT FROM NULL
  ;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward slides_get: expected 1 row, updated %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'gws-mcp';
  IF n <> 87 THEN RAISE EXCEPTION 'rows for gws-mcp: expected 87, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'gws-mcp' AND t.name IN ('gmail_list', 'gmail_list_drafts', 'gmail_list_filters', 'gmail_list_labels', 'gmail_mark_read', 'gmail_mark_spam', 'gmail_read', 'gmail_reply', 'gmail_save_attachment_to_drive', 'gmail_search', 'gmail_send', 'gmail_send_draft', 'gmail_trash', 'gmail_trash_thread', 'gmail_unmark_spam', 'gmail_untrash', 'gmail_untrash_thread', 'gmail_update_draft', 'gmail_update_label', 'gws_run', 'sheets_add_tab', 'sheets_append', 'sheets_batch_update', 'sheets_clear', 'sheets_copy_tab_to', 'sheets_create', 'sheets_delete', 'sheets_delete_tab', 'sheets_find_rows', 'sheets_format_range', 'sheets_format_table', 'sheets_get_metadata', 'sheets_query', 'sheets_read', 'sheets_rename_tab', 'sheets_update', 'slides_batch_update', 'slides_create', 'slides_delete', 'slides_get');
COMMIT;
