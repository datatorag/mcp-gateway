import { redirect } from "next/navigation";

/** API keys were removed (SCRUM-451): every client connects with OAuth. The
 * old address is kept so a bookmark lands on the dashboard, not a 404. */
export default function ApiKeysPage() {
  redirect("/dashboard");
}
