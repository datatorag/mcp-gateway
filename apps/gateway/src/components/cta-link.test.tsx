import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { CtaLink } from "./cta-link";

describe("CtaLink", () => {
  it("is a plain anchor for sign-in, so it is never prefetched or client-routed", () => {
    const el = CtaLink({ href: "/auth/google?next=%2Fpricing", children: "Get Started" });
    expect(el.type).toBe("a");
    expect(renderToStaticMarkup(el)).toBe('<a href="/auth/google?next=%2Fpricing">Get Started</a>');
  });

  it("is a next/link for a page", () => {
    const el = CtaLink({ href: "/dashboard/agent", className: "x", children: "Open Agent" });
    expect(el.type).toBe(Link);
    expect(el.props).toMatchObject({ href: "/dashboard/agent", className: "x" });
  });
});
