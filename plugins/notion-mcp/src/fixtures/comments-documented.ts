/* Shape from Notion's API reference, not recorded. The recorded comment
 * list (comments.json) is empty, so a list with comments in it is written
 * here from the reference's comment object: id, parent, discussion_id,
 * created_time, last_edited_time, created_by (a partial user), rich_text. */

export const COMMENTS_PAGE = {
  object: "list",
  results: [
    {
      object: "comment",
      id: "98b9d6e2-ada7-430b-83d6-fa8b940aab8a",
      parent: { type: "page_id", page_id: "122f53f3-d53e-4072-842d-9891b983e4e0" },
      discussion_id: "8a833e78-9222-4021-8c7c-afd9c388c4b1",
      created_time: "2026-10-21T03:40:00.000Z",
      last_edited_time: "2026-10-21T03:40:00.000Z",
      created_by: { object: "user", id: "460f4399-740e-44ab-827d-0134421cdedf" },
      rich_text: [
        { type: "text", text: { content: "Can this ship ", link: null }, plain_text: "Can this ship ", href: null },
        { type: "text", text: { content: "Friday", link: null }, annotations: { bold: true }, plain_text: "Friday", href: null },
        { type: "text", text: { content: "?", link: null }, plain_text: "?", href: null },
      ],
    },
    {
      object: "comment",
      id: "737b7e81-36d0-415c-8368-caf0e494334c",
      parent: { type: "block_id", block_id: "38b921ac-42f6-42b1-8f1b-19c2c78be896" },
      discussion_id: "8a833e78-9222-4021-8c7c-afd9c388c4b1",
      created_time: "2026-10-21T03:41:00.000Z",
      last_edited_time: "2026-10-21T03:41:00.000Z",
      created_by: { object: "user", id: "460f4399-740e-44ab-827d-0134421cdedf", name: "Test User" },
      rich_text: [{ type: "text", text: { content: "Yes.", link: null }, plain_text: "Yes.", href: null }],
    },
  ],
  next_cursor: "8c909279-1c69-49c8-82fc-94937870266d",
  has_more: true,
  type: "comment",
  comment: {},
};
