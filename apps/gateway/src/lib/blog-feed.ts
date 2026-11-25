import { BLOG_DESCRIPTION, BLOG_FEED_PATH, BLOG_FEED_TYPE, BLOG_HEADING, BLOG_PATH } from "@/app/blog/copy";
import { getAllPosts, postModified, postSearchDescription, postUrl } from "./blog";
import { SITE_URL } from "./site-schema";

/**
 * The blog as an RSS 2.0 feed, for a reader or a program that polls a feed
 * to learn a post exists. Every post, newest first, each with its headline,
 * its address (also its id), the day it was published, and its description.
 * Built from the same records the pages render.
 */

export const BLOG_FEED_URL = `${SITE_URL}${BLOG_FEED_PATH}`;

/** Text made safe to sit inside an XML element or attribute. */
export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Characters XML 1.0 does not allow at all.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** A `YYYY-MM-DD` day as the date form RSS asks for. */
const feedDate = (day: string): string => new Date(`${day}T00:00:00Z`).toUTCString();

const element = (name: string, text: string): string => `<${name}>${xmlEscape(text)}</${name}>`;

export function blogFeedXml(): string {
  const posts = getAllPosts();
  const newest = posts.map(postModified).sort().at(-1);
  const items = posts.map((post) =>
    [
      "    <item>",
      `      ${element("title", post.title)}`,
      `      ${element("link", postUrl(post.slug))}`,
      `      <guid isPermaLink="true">${xmlEscape(postUrl(post.slug))}</guid>`,
      `      ${element("pubDate", feedDate(post.date))}`,
      `      ${element("description", postSearchDescription(post))}`,
      "    </item>",
    ].join("\n")
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    ${element("title", BLOG_HEADING)}`,
    `    ${element("link", `${SITE_URL}${BLOG_PATH}`)}`,
    `    ${element("description", BLOG_DESCRIPTION)}`,
    "    <language>en</language>",
    ...(newest ? [`    ${element("lastBuildDate", feedDate(newest))}`] : []),
    `    <atom:link href="${xmlEscape(BLOG_FEED_URL)}" rel="self" type="${BLOG_FEED_TYPE}"/>`,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
