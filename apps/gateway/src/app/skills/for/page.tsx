import { redirect } from "next/navigation";

/** `/skills/for` is not a page — the personas are surfaced on `/skills` and
 * on the home page. Without this the bare path would fall through to the
 * `[slug]` skill route and 404 on a link someone reasonably guessed. */
export default function PersonaIndexRedirect() {
  redirect("/skills");
}
