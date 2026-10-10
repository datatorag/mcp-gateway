import Link from "next/link";
import type { ComponentProps } from "react";
import { isAuthFlowHref } from "@/lib/sign-in";

/**
 * A call to action whose destination depends on who is looking: the product
 * for a signed-in visitor, sign-in for everyone else.
 *
 * The two need different elements. A page is a `next/link`. Sign-in is a
 * server route that redirects to Google, and must be a plain anchor: a
 * prefetch would start it on render, and the click handler that attaches
 * attribution to sign-in links reads a real `href` at click time.
 */
export function CtaLink({
  href,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  if (isAuthFlowHref(href)) return <a href={href} {...props} />;
  return <Link href={href} {...props} />;
}
