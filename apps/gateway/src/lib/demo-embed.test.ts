import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { getAllPosts } from "./blog";
import { demoMarkerIds, splitDemoMarkers } from "./demo-embed";
import { DEMO_SCRIPTS } from "@/components/demo/demo-scripts";
import { DEMO_WINDOWS } from "@/components/demo/demo-layout";

const KNOWN = ["jira", "sheets"];

describe("demo markers in a post", () => {
  it("leaves a post with no marker exactly as it was: one segment, the same string", () => {
    const html = "<p>One.</p>\n<!-- a comment that is not a marker -->\n<p>Two.</p>\n";
    const segments = splitDemoMarkers(html, KNOWN);
    expect(segments).toEqual([{ kind: "html", html }]);
    // The same string, not a rebuilt one.
    expect((segments[0] as { html: string }).html).toBe(html);
  });

  it("splits at a marker and keeps the HTML on both sides intact", () => {
    const before = "<p>Before.</p>\n<p><img src=\"/blog/diagram.png\" alt=\"\"></p>\n";
    const after = "\n<h2>After</h2>\n<p>Text.</p>\n";
    const segments = splitDemoMarkers(`${before}<!-- demo:jira -->${after}`, KNOWN);
    expect(segments).toEqual([
      { kind: "html", html: before },
      { kind: "demo", id: "jira" },
      { kind: "html", html: after },
    ]);
    // Nothing lost, nothing added: the HTML segments are the post minus the marker.
    const rejoined = segments
      .map((s) => (s.kind === "html" ? s.html : ""))
      .join("");
    expect(rejoined).toBe(before + after);
  });

  it("accepts the marker with or without the inner spaces", () => {
    for (const marker of ["<!-- demo:jira -->", "<!--demo:jira-->", "<!--  demo:jira  -->"]) {
      expect(splitDemoMarkers(`<p>a</p>${marker}<p>b</p>`, KNOWN)[1]).toEqual({
        kind: "demo",
        id: "jira",
      });
    }
  });

  it("handles a marker first, last, and more than one", () => {
    expect(splitDemoMarkers("<!-- demo:jira --><p>b</p>", KNOWN)).toEqual([
      { kind: "demo", id: "jira" },
      { kind: "html", html: "<p>b</p>" },
    ]);
    expect(splitDemoMarkers("<p>a</p><!-- demo:jira -->\n", KNOWN)).toEqual([
      { kind: "html", html: "<p>a</p>" },
      { kind: "demo", id: "jira" },
    ]);
    expect(
      splitDemoMarkers("<p>a</p><!-- demo:jira --><p>b</p><!-- demo:sheets --><p>c</p>", KNOWN)
    ).toEqual([
      { kind: "html", html: "<p>a</p>" },
      { kind: "demo", id: "jira" },
      { kind: "html", html: "<p>b</p>" },
      { kind: "demo", id: "sheets" },
      { kind: "html", html: "<p>c</p>" },
    ]);
  });

  it("leaves a marker for an unknown id as the comment it was", () => {
    // It renders nothing, which is the safe failure: no empty frame, no
    // script picked by guesswork. The corpus test below is what stops one
    // from shipping.
    const html = "<p>a</p><!-- demo:nope --><p>b</p>";
    expect(splitDemoMarkers(html, KNOWN)).toEqual([{ kind: "html", html }]);
    expect(demoMarkerIds(html)).toEqual(["nope"]);
  });

  it("does not read an id out of anything but the marker shape", () => {
    // Uppercase, a path, an injected attribute: none is an id, so none splits.
    for (const html of [
      "<!-- demo:JIRA -->",
      "<!-- demo:../jira -->",
      '<!-- demo:jira" onload="x -->',
      "<!-- demo: jira -->",
      "demo:jira",
    ]) {
      expect(splitDemoMarkers(html, KNOWN)).toEqual([{ kind: "html", html }]);
    }
  });

  it("survives marked: a marker on its own line reaches the HTML as a comment between blocks", () => {
    const html = marked.parse(
      "Intro paragraph.\n\n![diagram](/blog/diagram.png)\n\n<!-- demo:jira -->\n\nNext paragraph.\n"
    ) as string;
    const segments = splitDemoMarkers(html, KNOWN);
    expect(segments.map((s) => s.kind)).toEqual(["html", "demo", "html"]);
    const [first, , last] = segments as { html: string }[];
    // The marker was not wrapped in a paragraph, so neither side is left
    // holding half of one.
    expect(first.html.trim().endsWith("</p>")).toBe(true);
    expect(last.html.trim().startsWith("<p>")).toBe(true);
    expect(first.html).toContain("diagram.png");
    expect(last.html).toContain("Next paragraph.");
  });
});

describe("the posts we actually publish", () => {
  it("every script has a window layout, so every script id can be embedded", () => {
    expect(Object.keys(DEMO_WINDOWS).sort()).toEqual(
      DEMO_SCRIPTS.map((s) => s.id).sort()
    );
  });

  it("every demo marker in a post names a script that exists", () => {
    const known = DEMO_SCRIPTS.map((s) => s.id);
    for (const post of getAllPosts()) {
      for (const id of demoMarkerIds(post.html)) {
        expect(known, `${post.slug} asks for demo "${id}"`).toContain(id);
      }
    }
  });
});
