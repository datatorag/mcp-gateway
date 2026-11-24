import { getAllPersonas } from "@/lib/personas";
import { buildSiteNav } from "@/lib/site-nav";
import { NavbarClient } from "./navbar-client";

/**
 * The site's navbar (SCRUM-506). A server component, so it can read the
 * persona pages from disk: it builds the menu from `lib/site-nav.ts` and
 * hands it, as plain data, to the client component that opens the panels.
 * Every public page renders `<Navbar />` itself; there is none in the root
 * layout.
 */
export function Navbar() {
  return <NavbarClient nav={buildSiteNav(getAllPersonas())} />;
}
