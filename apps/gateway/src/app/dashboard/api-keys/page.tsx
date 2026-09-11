import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { ApiKeysPanel } from "./api-keys-panel";

export const dynamic = "force-dynamic";

/**
 * API keys (SCRUM-245): the machine credential.
 *
 * An OAuth session is for a client that persists the rotated refresh token
 * it is handed. A CLI or a harness that loads a credential file and never
 * writes it back dies at its first refresh; a key does not refresh and does
 * not rotate, so it is the credential for that client. Minted here, shown
 * once, revoked here.
 *
 * The session check is not redundant with the middleware, for the reason
 * the MCP config page gives: the middleware checks that a session cookie is
 * present, not that it is valid.
 */
export default async function ApiKeysPage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">API keys</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        A key is a bearer for the MCP endpoint that never expires on its own and never
        rotates, for a CLI, a harness or a job that cannot keep a rotating refresh token.
        It acts as you, with the same connections, the same approvals and the same usage
        count as a signed-in session. Revoke it here the moment you no longer need it.
      </p>
      <ApiKeysPanel />
    </div>
  );
}
