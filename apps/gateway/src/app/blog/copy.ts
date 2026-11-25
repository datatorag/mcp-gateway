/** The blog index's address, heading, `<title>`, and description, and the
 * feed's address. Kept beside the page (a page file exports only the page)
 * so the feed, `/llms.txt`, and the tests read the same strings. */
export const BLOG_PATH = "/blog";
export const BLOG_HEADING = "DataToRAG blog";
export const BLOG_SEARCH_TITLE = "DataToRAG Blog: Claude, Google Workspace, and MCP";
export const BLOG_DESCRIPTION =
  "How an agent such as Claude works in Gmail, Drive, Sheets, Jira, and Notion through MCP, and how the ways to connect them compare.";

/** The feed of posts: RSS 2.0, newest first. */
export const BLOG_FEED_PATH = "/blog/feed.xml";
export const BLOG_FEED_TYPE = "application/rss+xml";
