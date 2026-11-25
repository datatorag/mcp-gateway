import { permanentRedirect } from "next/navigation";
import { ALL_TOOLS_PATH } from "../docs/tools/copy";

// The per-connector pages live under /tools/<slug>; the list of every tool
// is a docs page. This address only sends a reader there.
export default function ToolsIndexPage() {
  permanentRedirect(ALL_TOOLS_PATH);
}
