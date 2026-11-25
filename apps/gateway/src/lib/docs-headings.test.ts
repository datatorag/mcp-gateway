import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { addHeadingAnchors, anchorDocHeadings, headingSlug, headingText } from "./docs-headings";
import { getAllDocs } from "./docs";
import { faqAnchor } from "./faq";

describe("a heading's id", () => {
  it("is its words in lowercase ASCII, joined by hyphens", () => {
    expect(headingSlug("Who a reply goes to")).toBe("who-a-reply-goes-to");
    expect(headingSlug("  Available operations: Gmail & Drive  ")).toBe("available-operations-gmail-drive");
    expect(headingSlug("What's new")).toBe("whats-new");
    expect(headingSlug("Résumé naïve")).toBe("resume-naive");
    expect(headingSlug("25 MB, all files")).toBe("25-mb-all-files");
  });

  it("is never empty", () => {
    expect(headingSlug("???")).toBe("section");
    expect(headingSlug("")).toBe("section");
  });

  it("reads a heading's words through its markup and entities", () => {
    expect(headingText("The <code>account</code> argument")).toBe("The account argument");
    expect(headingText("Don&#39;t &amp; won&#x27;t &lt;b&gt;")).toBe("Don't & won't <b>");
  });
});

describe("headings in a docs page", () => {
  const render = (markdown: string) => anchorDocHeadings(marked.parse(markdown) as string);

  it("gives every h2 and h3 an id and a link beside it, and leaves other levels alone", () => {
    const { html, headings } = render("# Title\n\n## Sending mail\n\nText.\n\n### Who a reply goes to\n\n#### Deep\n");
    expect(headings).toEqual([
      { level: 2, id: "sending-mail", text: "Sending mail" },
      { level: 3, id: "who-a-reply-goes-to", text: "Who a reply goes to" },
    ]);
    expect(html).toContain('<h2 id="sending-mail">Sending mail</h2>');
    expect(html).toContain('<h3 id="who-a-reply-goes-to">Who a reply goes to</h3>');
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<h4>Deep</h4>");
  });

  it("puts the link beside the heading, never inside its text, with a name of its own", () => {
    const { html } = render("## Sending `mail` & more\n");
    expect(html).toContain(
      '<div class="docs-heading"><h2 id="sending-mail-more">Sending <code>mail</code> &amp; more</h2>' +
        '<a class="docs-heading-link" href="#sending-mail-more" aria-label="Link to: Sending mail &amp; more"><span aria-hidden="true">#</span></a></div>'
    );
    // The heading's own content holds no link.
    expect(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)![1]).not.toContain("<a");
  });

  it("numbers a repeated heading, in page order", () => {
    const { headings } = render("## Gmail\n\n### Limits\n\n## Drive\n\n### Limits\n\n### Limits\n");
    expect(headings.map((h) => h.id)).toEqual(["gmail", "limits", "drive", "limits-2", "limits-3"]);
  });

  it("never makes an id another heading already has", () => {
    const { headings } = render("## Limits 2\n\n## Limits\n\n## Limits\n");
    expect(headings.map((h) => h.id)).toEqual(["limits-2", "limits", "limits-3"]);
    const own = anchorDocHeadings('<h2>Setup</h2><h2 id="setup">Setup</h2>');
    expect(own.headings.map((h) => h.id)).toEqual(["setup-2", "setup"]);
    expect(own.html).toContain('<h2 id="setup">Setup</h2>');
  });

  it("gives the same ids on a second pass over the same page", () => {
    const html = marked.parse("## One\n\n## Two\n\n## One\n") as string;
    expect(addHeadingAnchors(html)).toBe(addHeadingAnchors(html));
  });

  it("keeps a link to a section working: the address a page writes is the id the heading gets", () => {
    const { html, headings } = render("See [who a reply goes to](#who-a-reply-goes-to).\n\n## Who a reply goes to\n");
    expect(html).toContain('<a href="#who-a-reply-goes-to">who a reply goes to</a>');
    expect(headings.map((h) => h.id)).toContain("who-a-reply-goes-to");
  });
});

describe("every docs page", () => {
  const docs = getAllDocs();
  const idsIn = (html: string) => [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);

  it("has headings to address", () => {
    expect(docs.length).toBeGreaterThan(10);
    expect(docs.flatMap((d) => idsIn(d.html)).length).toBeGreaterThan(50);
  });

  it.each(docs.map((d) => [d.slug, d] as const))("%s: every h2 and h3 has an id, and no id repeats", (_slug, doc) => {
    const headings = [...doc.html.matchAll(/<h[23]\b([^>]*)>/g)];
    expect(headings.filter((m) => !/\sid="[a-z0-9]+(?:-[a-z0-9]+)*"/.test(m[1])).map((m) => m[0])).toEqual([]);
    // The page's questions carry ids too; a section must not take one.
    const ids = [...idsIn(doc.html), ...doc.faqs.map((f) => faqAnchor(f.q))];
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it.each(docs.map((d) => [d.slug, d] as const))("%s: every link to a section of its own names a section it has", (_slug, doc) => {
    const ids = new Set([...idsIn(doc.html), ...doc.faqs.map((f) => faqAnchor(f.q))]);
    const targets = [...doc.html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]);
    expect(targets.filter((t) => !ids.has(t))).toEqual([]);
  });
});
