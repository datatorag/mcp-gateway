// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/navbar", () => ({ Navbar: () => null }));
vi.mock("@/components/add-to-agent", () => ({ AddToAgent: () => <div data-add-to-agent="" /> }));
vi.mock("@/components/demo/demo-embed", () => ({ DemoEmbed: () => <div data-demo="" />, EMBEDDABLE_DEMO_IDS: [] }));
vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

/* A post that was never edited, for the rules about one: every published
   post may have been edited, so the page is also given a copy of a real post
   with its edit taken away. */
const NEVER_EDITED = "a-post-never-edited";
vi.mock("@/lib/blog", async (original) => {
  const real = await original<typeof import("@/lib/blog")>();
  return {
    ...real,
    getPostBySlug: (slug: string) => {
      if (slug !== NEVER_EDITED) return real.getPostBySlug(slug);
      const { updated: _updated, updatedNote: _note, ...post } = real.getAllPosts()[0];
      return { ...post, slug: NEVER_EDITED };
    },
  };
});

import BlogArticlePage, { generateMetadata } from "./page";
import { getAllPosts, getPostBySlug, type BlogPost } from "@/lib/blog";
import { formatContentDate } from "@/lib/utils";
import { afterEditedDate, editNoteHtml, splitEditNote } from "@/lib/edit-note";

const posts = getAllPosts();
const noted = posts.filter((p) => p.updated && p.updatedNote);
const datedOnly = posts.filter((p) => p.updated && !p.updatedNote);
const untouched = [...posts.filter((p) => !p.updated), getPostBySlug(NEVER_EDITED)!];

const render = async (post: BlogPost) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(await BlogArticlePage({ params: Promise.resolve({ slug: post.slug }) }));
  return host;
};
const article = (host: HTMLElement) =>
  (JSON.parse(host.querySelector('script[type="application/ld+json"]')!.textContent!) as Record<string, unknown>[]).find((n) => n["@type"] === "BlogPosting")!;

const edited = posts.filter((p) => p.updated);
const text = (el: Element) => el.textContent!.replace(/\s+/g, " ").trim();
/** A note's words as a reader sees them: its links and code marks rendered away. */
const shown = (markdown: string) => {
  const el = document.createElement("div");
  el.innerHTML = editNoteHtml(markdown);
  return text(el);
};

/* The two tiers of disclosing an edit to a post. A change to what a post
   claims carries `updatedNote`, and the page shows it; any other edit moves
   the stated modified date and shows only its day. */
describe("a blog post's edit note", () => {
  it("has posts of each kind to read", () => {
    expect(noted.length).toBeGreaterThan(0);
    expect(datedOnly.length).toBeGreaterThan(0);
    expect(untouched.length).toBeGreaterThan(0);
  });

  it.each(noted.map((p) => [p.slug, p] as const))("%s: the note is after the body, shows its newest entry, folds the rest, and prints the day once", async (_slug, post) => {
    const host = await render(post);
    const note = host.querySelector("#edit-note")!;
    expect(note).not.toBeNull();
    expect(host.querySelectorAll("#edit-note")).toHaveLength(1);
    expect(note.className).toContain("scroll-mt-28");

    const [latest, ...earlier] = splitEditNote(post.updatedNote!);
    const day = formatContentDate(post.updated!);

    // The newest entry, in full, after one "Edited <day>".
    const first = note.querySelector("[data-edit-latest]")!;
    expect(first.querySelector("time")!.getAttribute("datetime")).toBe(post.updated);
    expect(text(first)).toBe(shown(`Edited ${day}${afterEditedDate(latest, day)}`));
    expect(text(first).startsWith(`Edited ${day}`)).toBe(true);
    // The day is not said again straight after itself.
    expect(text(first)).not.toMatch(new RegExp(`^Edited ${day}[:,]? ${day}`));
    expect(first.closest("details")).toBeNull();

    // Every earlier entry is in the page, inside a closed <details>.
    const fold = note.querySelector("details");
    if (earlier.length === 0) {
      expect(fold).toBeNull();
    } else {
      expect(fold).not.toBeNull();
      expect(fold!.hasAttribute("open")).toBe(false);
      expect(text(fold!.querySelector("summary")!)).toBe("Earlier edits");
      expect([...fold!.querySelectorAll("li")].map(text)).toEqual(earlier.map((e) => shown(e.text)));
    }
    expect(note.querySelector("script")).toBeNull();
    // Nothing of the note is lost between the two parts.
    expect(text(note)).toBe(
      [`Edited ${day}${afterEditedDate(latest, day)}`, ...(earlier.length > 0 ? ["Earlier edits", ...earlier.map((e) => e.text)] : [])].map(shown).join("")
    );

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
    expect(link.textContent).toBe(`Edited ${day}`);
    expect(link.compareDocumentPosition(body[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The note's words are not above the body.
    expect(host.querySelector("header")!.textContent).not.toContain(shown(latest.text).slice(0, 60));
  });

  it.each(datedOnly.map((p) => [p.slug, p] as const))("%s: an edit with no note shows its day and no note, and still moves the stated date", async (_slug, post) => {
    const host = await render(post);
    expect(host.querySelector("#edit-note")).toBeNull();
    expect(host.querySelector('a[href="#edit-note"]')).toBeNull();
    expect(host.querySelector("details")).toBeNull();
    expect(text(host.querySelector("header [data-edited]")!)).toBe(`Edited ${formatContentDate(post.updated!)}`);
    expect(article(host).dateModified).toBe(post.updated);
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: post.slug }) });
    expect(metadata.openGraph).toMatchObject({ modifiedTime: post.updated });
  });

  it.each(edited.map((p) => [p.slug, p] as const))("%s: the day shown as Edited is the modified date the structured data states", async (_slug, post) => {
    const host = await render(post);
    const stated = article(host).dateModified;
    expect(stated).toBe(post.updated);
    const times = [...host.querySelectorAll("[data-edited] time, [data-edit-latest] > span:first-child time")];
    expect(times.length).toBe(post.updatedNote ? 2 : 1);
    for (const time of times) {
      expect(time.getAttribute("datetime")).toBe(stated);
      expect(time.textContent).toBe(formatContentDate(stated as string));
    }
  });

  it("a post never edited shows no Edited day and states its own date", async () => {
    for (const post of untouched) {
      const host = await render(post);
      expect(host.querySelector("#edit-note")).toBeNull();
      expect(host.querySelector("[data-edited]")).toBeNull();
      expect(host.querySelector("header")!.textContent).not.toContain("Edited");
      expect(article(host).dateModified).toBe(post.date);
    }
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: untouched[0].slug }) });
    expect(metadata.openGraph).not.toHaveProperty("modifiedTime");
  });
});

/* What a post tells a search result, a link preview, and a program. */
describe("a blog post's metadata and structured data", () => {
  const meta = (post: BlogPost) => generateMetadata({ params: Promise.resolve({ slug: post.slug }) });

  it.each(posts.map((p) => [p.slug, p] as const))("%s: title, description, and the heading", async (_slug, post) => {
    const metadata = await meta(post);
    expect(metadata.title).toBe(post.searchTitle ?? `${post.title} | DataToRAG`);
    expect(metadata.description).toBe(post.searchDescription ?? post.excerpt);
    expect(metadata.openGraph).toMatchObject({ title: post.searchTitle ?? post.title, description: post.searchDescription ?? post.excerpt });
    expect(metadata.twitter).toMatchObject({ title: post.searchTitle ?? post.title, description: post.searchDescription ?? post.excerpt });
    // The page's heading stays the post's own headline.
    const host = await render(post);
    expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector("h1")!.textContent).toBe(post.title);
  });

  it("a written search title and description are what the page sends", async () => {
    const withTitle = posts.find((p) => p.searchTitle);
    const withDescription = posts.find((p) => p.searchDescription);
    // Until a post writes one, the fallback above is the whole behavior.
    if (withTitle) expect((await meta(withTitle)).title).toBe(withTitle.searchTitle);
    if (withDescription) expect((await meta(withDescription)).description).toBe(withDescription.searchDescription);
  });

  it("no two posts send the same title", async () => {
    const titles = await Promise.all(posts.map(async (p) => (await meta(p)).title as string));
    expect(titles.filter((t, i) => titles.indexOf(t) !== i)).toEqual([]);
  });

  it.each(posts.map((p) => [p.slug, p] as const))("%s: the article names a picture, its publisher, and its trail from the home page", async (_slug, post) => {
    const host = await render(post);
    const nodes = JSON.parse(host.querySelector('script[type="application/ld+json"]')!.textContent!) as Record<string, unknown>[];
    const posting = nodes.find((n) => n["@type"] === "BlogPosting")!;
    expect(posting.headline).toBe(post.title);
    expect(posting.datePublished).toBe(post.date);
    // A picture always, absolute: the post's own, else the site's card.
    const own = post.ogImage ?? post.coverImage;
    expect(posting.image).toBe(own ? `https://datatorag.com${own}` : "https://datatorag.com/social-card.png");
    expect(posting.publisher).toMatchObject({ "@type": "Organization", "@id": "https://datatorag.com/#organization", name: "DataToRAG" });
    const trail = nodes.find((n) => n["@type"] === "BreadcrumbList")!.itemListElement as { name: string; item: string }[];
    expect(trail.map((t) => t.item)).toEqual(["https://datatorag.com", "https://datatorag.com/blog", `https://datatorag.com/blog/${post.slug}`]);
  });

  it("a post with no cover still names a picture, and there is one to check", () => {
    expect(posts.some((p) => !p.coverImage && !p.ogImage)).toBe(true);
  });

  it("the cover loads first, at the width it is drawn, in its own shape", async () => {
    const post = posts.find((p) => p.coverImage)!;
    const host = await render(post);
    const cover = host.querySelector("article img[sizes]")!;
    expect(cover.getAttribute("sizes")).toBe("(min-width: 768px) 720px, 100vw");
    expect(cover.getAttribute("loading")).not.toBe("lazy");
    expect(cover.getAttribute("fetchpriority")).toBe("high");
    expect(Number(cover.getAttribute("width"))).toBeGreaterThan(0);
    // Every picture in the body waits for the reader.
    for (const img of host.querySelectorAll(".prose img")) expect(img.getAttribute("loading")).toBe("lazy");
  });
});
