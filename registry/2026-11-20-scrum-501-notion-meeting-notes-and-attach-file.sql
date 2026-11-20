-- Registry change for notion-mcp. PROPOSAL: NOT RUN.
-- Generated from the tool files CI kept for gateway 0d278d4d621d8edb8c402210952c4224691e0d36 (what is running) and 61c85b08d507b81c3134dbea4b8ae56c91690659.
-- 0 row(s) change, 2 added, 0 removed.
-- Rows for notion-mcp: 18 before, 20 after.
--   adds notion_attach_file
--   adds notion_list_meeting_notes
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
  -- notion_attach_file: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'notion_attach_file', 'notion-mcp__notion_attach_file',
    'Puts a file on a Notion page, appended at the end of the page: an image as an image block, a PDF as a PDF block, and any other file as a file block. The file is named by a file reference. A reference to a file in Gmail or Drive names where it lives: the gateway fetches it and hands it straight to Notion, so its bytes stay out of the conversation. A gmail_message reference puts a whole email on the page as its original .eml, and a gmail_attachment reference one attachment of an email, named by the part id gmail_read lists for it. A drive_file reference puts a Google Drive file as stored, and a drive_export reference a Google Docs, Sheets or Slides file exported to a format such as pdf. A content reference carries a file the caller already holds, as standard base64 in the call, at most 1 MB decoded. An upload reference names a file the user sent through file_upload_link, up to 25 MB, which goes to one call. One file a call. Notion takes a file of at most 20 MB in one part, which is what this tool sends, and a free Notion workspace accepts files of at most 5 MB; the workspace''s own limit is read from Notion before anything is sent, and a larger file is refused with nothing sent. The answer is a receipt with the new block''s id and type, the file''s name, size and type, the SHA-256 and byte count of what was sent, and the page''s id, title and URL. The upload is not sent twice; after a failure, the page shows whether the file arrived.',
    '{"type":"object","properties":{"page_id":{"type":"string","description":"The page''s Notion id or URL. The file is appended at the end of this page."},"file":{"type":"object","description":"A file reference. For a whole Gmail message: {\"type\": \"gmail_message\", \"message_id\": \"<id>\"}. For one attachment of a message: {\"type\": \"gmail_attachment\", \"message_id\": \"<id>\", \"part_id\": \"<part id>\"}. For a Drive file as stored: {\"type\": \"drive_file\", \"file_id\": \"<id>\"}. For a Google Docs, Sheets or Slides file exported: {\"type\": \"drive_export\", \"file_id\": \"<id>\", \"format\": \"pdf\"}. For a file the caller already holds: {\"type\": \"content\", \"name\": \"<file name>\", \"base64\": \"<standard base64, one unbroken string>\"}, at most 1 MB decoded. For a file sent through file_upload_link: {\"type\": \"upload\", \"upload_id\": \"<id from its receipt>\"}.","properties":{"type":{"type":"string","enum":["gmail_message","gmail_attachment","drive_file","drive_export","content","upload"],"description":"The kind of file reference: gmail_message for the whole email as its original .eml, gmail_attachment for one attachment of it, drive_file for a Drive file as stored, drive_export for a Google Docs, Sheets or Slides file exported to a format, content for a file carried in the call, or upload for a file sent through file_upload_link."},"message_id":{"type":"string","description":"The Gmail message ID, as returned by a Gmail search or read. Required with gmail_message and gmail_attachment"},"file_id":{"type":"string","description":"The Google Drive file ID. Required with drive_file and drive_export"},"format":{"type":"string","description":"What to export to, with drive_export: pdf, docx, txt, md, html, rtf, odt or epub for a Doc; pdf, xlsx, csv (the opening tab), tsv, html or ods for a Sheet; pdf, pptx, txt or odp for Slides"},"part_id":{"type":"string","description":"The attachment''s part id as gmail_read lists it, such as \"1\" or \"0.1\". Required with gmail_attachment, ignored otherwise."},"account":{"type":"string","description":"Which connected Google account holds the message or file, by email address. Optional; omit it to use the default account. Not taken with content."},"name":{"type":"string","description":"The file''s name, with its extension. Required with content."},"base64":{"type":"string","description":"The file''s bytes in standard base64 as one unbroken string, at most 1 MB decoded. Required with content."},"mime_type":{"type":"string","description":"The file''s type, such as image/png. Optional with content; omitted, it comes from the name''s extension."},"upload_id":{"type":"string","description":"The id from the receipt of a file sent through file_upload_link. Required with upload."}},"required":["type"]},"filename":{"type":"string","description":"The name the file has on the page. Optional; by default the name comes from the source."}},"required":["page_id","file"]}'::jsonb,
    false, true
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_attach_file');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_attach_file: expected 1 row, inserted %', n; END IF;

  -- notion_list_meeting_notes: a new row
  INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint, destructive_hint)
  SELECT s.id, 'notion_list_meeting_notes', 'notion-mcp__notion_list_meeting_notes',
    'Lists the Notion AI meeting notes of meetings the connected Notion user attended, the newest at the top, created on or after a date and optionally on or before another, and optionally only those whose title contains some text. Each note carries its id, title, the meeting''s start and end time, its attendees (names where Notion gives them), its status, the AI summary and the notes as text, and action_items: every to-do in the summary and notes with whether it is checked, and every list item under a heading that says action items or next steps. The transcript is left out unless include_transcript is true. The text of one answer is held to max_body_chars together (default 100,000): when there is more, the oldest notes keep their title and times but not their text, and left_out lists their ids. Notion returns at most 50 notes and no cursor; has_more true means more notes match than were returned, and a narrower date range reads the rest. Notes still being transcribed or summarized come back with their status and no summary. A workspace without Notion AI meeting notes answers with a sentence saying so.',
    '{"type":"object","properties":{"since":{"type":"string","description":"Notes created on or after this day: a date as YYYY-MM-DD, or one of today, yesterday, one_week_ago. Default yesterday."},"until":{"type":"string","description":"Notes created on or before this day: a date as YYYY-MM-DD, or one of today, yesterday, one_week_ago. Absent means up to now."},"title":{"type":"string","description":"Only notes whose title contains this text."},"include_transcript":{"type":"boolean","description":"Whether each note carries its transcript as text. Default false."},"limit":{"type":"integer","minimum":1,"maximum":50,"description":"How many notes, from 1 to 50. Default 10."},"max_body_chars":{"type":"integer","minimum":1000,"maximum":200000,"description":"The text of all notes in one answer, together, in characters. Default 100,000, at most 200,000."}}}'::jsonb,
    true, false
  FROM mcp_servers s
  WHERE s.slug = 'notion-mcp'
    AND NOT EXISTS (SELECT 1 FROM tools t WHERE t.namespaced_name = 'notion-mcp__notion_list_meeting_notes');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'forward notion_list_meeting_notes: expected 1 row, inserted %', n; END IF;

  SELECT count(*) INTO n FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id WHERE s.slug = 'notion-mcp';
  IF n <> 20 THEN RAISE EXCEPTION 'rows for notion-mcp: expected 20, found %', n; END IF;
END
$registry_change$;
SELECT t.name, md5(t.description) AS description_md5, md5(t.input_schema_json::text) AS schema_md5, t.read_only_hint, t.destructive_hint, t.updated_at
FROM mcp_servers s JOIN tools t ON s.id = t.mcp_server_id
WHERE s.slug = 'notion-mcp' AND t.name IN ('notion_attach_file', 'notion_list_meeting_notes');
COMMIT;
