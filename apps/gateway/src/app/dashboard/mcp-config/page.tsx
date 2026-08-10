import { SetupInstructions } from "@/components/setup-instructions";

export const dynamic = "force-dynamic";

/**
 * The MCP config, on a route.
 *
 * It had none. The block was mounted as the LAST element of the dashboard and
 * the only in-app way to reach it was a button calling scrollIntoView, so it
 * could be linked to by nobody. Giving it an address is a promotion in
 * navigability even though the ticket frames the change as a demotion in
 * prominence: it stops being the first thing a new user meets, and starts
 * being something they can find on purpose.
 */
export default function McpConfigPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">
        MCP config
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Use your connected accounts from Claude, Cursor, or any other MCP
        client.
      </p>
      <div className="mt-6">
        <SetupInstructions sourcePrefix="wizard" />
      </div>
    </div>
  );
}
