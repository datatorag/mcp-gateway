// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/add-to-agent", () => ({ AddToAgent: () => <div data-add-to-agent="" /> }));
vi.mock("@/components/demo/demo-embed", () => ({ DemoEmbed: () => <div data-demo="" />, EMBEDDABLE_DEMO_IDS: [] }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

import BlogArticlePage, { generateMetadata } from "./page";
import { getAllPosts, type BlogPost } from "@/lib/blog";
import { formatContentDate } from "@/lib/utils";

const posts = getAllPosts();
const noted = posts.filter((p) => p.updated && p.updatedNote);
const datedOnly = posts.filter((p) => p.updated && !p.updatedNote);
const untouched = posts.filter((p) => !p.updated);

const render = async (post: BlogPost) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(await BlogArticlePage({ params: Promise.resolve({ slug: post.slug }) }));
  return host;
};
const article = (host: HTMLElement) =>
  (JSON.parse(host.querySelector('script[type="application/ld+json"]')!.textContent!) as Record<string, unknown>[]).find((n) => n["@type"] === "BlogPosting")!;

/* The two tiers of disclosing an edit to a post. A change to what a post
   claims carries `updatedNote`, and the page shows it; any other edit moves
   the stated modified date and shows nothing. */
describe("a blog post's edit note", () => {
  it("has posts of each kind to read", () => {
    expect(noted.length).toBeGreaterThan(0);
    expect(datedOnly.length).toBeGreaterThan(0);
    expect(untouched.length).toBeGreaterThan(0);
  });

  it.each(noted.map((p) => [p.slug, p] as const))("%s: the note is after the body, and the date line links to it", async (_slug, post) => {
    const host = await render(post);
    const note = host.querySelector("#edit-note")!;
    expect(note).not.toBeNull();
    expect(host.querySelectorAll("#edit-note")).toHaveLength(1);
    expect(note.querySelector("time")!.getAttribute("datetime")).toBe(post.updated);
    expect(note.textContent).toBe(`Edited ${formatContentDate(post.updated!)}: ${post.updatedNote}`);
    expect(note.className).toContain("scroll-mt-28");

    // After every part of the body, so the post opens with its own words.
    const body = [...host.querySelectorAll(".prose")];
    expect(body.length).toBeGreaterThan(0);
    for (const part of body) expect(part.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And before the questions and the pitch, as part of the article.
    const after = host.querySelector("[data-add-to-agent]")!;
    expect(note.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The date line still says the post was edited, and takes the reader there.
    const link = host.querySelector('header a[href="#edit-note"]')!;
    expect(link).not.toBeNull();
    expect(link.textContent).toBe(`Edited ${formatContentDate(post.updated!)}`);
    expect(link.compareDocumentPosition(body[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The note's words are on the page once, and not above the body.
    expect(host.querySelector("header")!.textContent).not.toContain(post.updatedNote);
  });

  it.each(datedOnly.slice(0, 5).map((p) => [p.slug, p] as const))("%s: an edit with no note shows nothing, and still moves the stated date", async (_slug, post) => {
    const host = await render(post);
    expect(host.querySelector("#edit-note")).toBeNull();
    expect(host.querySelector('a[href="#edit-note"]')).toBeNull();
    expect(host.querySelector("header")!.textContent).not.toContain("Edited");
    expect(article(host).dateModified).toBe(post.updated);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: post.slug }) });
    expect(metadata.openGraph).toMatchObject({ modifiedTime: post.updated });
  });

  it("a noted post states the same modified date, and a post never edited states its own date", async () => {
    expect(article(await render(noted[0])).dateModified).toBe(noted[0].updated);
    const host = await render(untouched[0]);
    expect(host.querySelector("#edit-note")).toBeNull();
    expect(article(host).dateModified).toBe(untouched[0].date);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: untouched[0].slug }) });
    expect(metadata.openGraph).not.toHaveProperty("modifiedTime");
  });
});
