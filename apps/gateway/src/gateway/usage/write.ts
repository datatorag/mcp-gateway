import type { Database } from "@datatorag-mcp/db";
import { usageEvents } from "@datatorag-mcp/db";
import type { OutcomeStatus } from "./classify";

/**
 * The stored error message is raw, not redacted (SCRUM-200): the row is the
 * user's own data, shown back only to them, and they already received the
 * full error live from the tool response. The redactor used to be the only
 * length cap on this path, so an explicit one replaces it: error_message is
 * an unbounded text column, and a provider that echoes a large input back in
 * its error would otherwise write that input, whole, on every failed call.
 *
 * Why this number: the row exists to be diagnosed, and the diagnostic part of
 * every provider envelope we store (code, status, reason, message, the first
 * few field violations) sits in its first couple of thousand characters. Past
 * that a message is carrying echoed content, not diagnosis. So the cap is a
 * few KB per row, comfortably inside the 200ms insert budget and the 90-day
 * raw retention, and eight times the old redactor's cap so a real envelope is
 * never cut. The marker tells a reader the cut happened.
 */
export const MAX_STORED_ERROR_LEN = 4000;
const TRUNCATION_MARKER = " [truncated]";

export function capStoredErrorMessage(input: string | null): string | null {
  if (input === null || input.length <= MAX_STORED_ERROR_LEN) return input;
  return (
    input.slice(0, MAX_STORED_ERROR_LEN - TRUNCATION_MARKER.length) +
    TRUNCATION_MARKER
  );
}

export interface UsageEventInput {
  userId: string;
  toolName: string;
  connector: string | null;
  accountEmail: string | null;
  status: OutcomeStatus;
  latencyMs: number;
  responseSizeBytes: number | null;
  errorMessage: string | null;
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "timeout" | "error"; error?: Error };

export async function writeUsageEventWithTimeout(
  insert: () => Promise<void>,
  timeoutMs: number
): Promise<WriteResult> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<WriteResult>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve({ ok: false, reason: "timeout" }),
      timeoutMs
    );
  });
  const workPromise = insert()
    .then<WriteResult>(() => ({ ok: true }))
    .catch<WriteResult>((err) => ({
      ok: false,
      reason: "error",
      error: err instanceof Error ? err : new Error(String(err)),
    }));
  const result = await Promise.race([workPromise, timeoutPromise]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  return result;
}

export async function writeUsageEvent(
  db: Database,
  input: UsageEventInput,
  timeoutMs = 200
): Promise<WriteResult> {
  return writeUsageEventWithTimeout(async () => {
    await db.insert(usageEvents).values({
      userId: input.userId,
      toolName: input.toolName,
      connector: input.connector,
      accountEmail: input.accountEmail,
      status: input.status,
      latencyMs: input.latencyMs,
      responseSizeBytes: input.responseSizeBytes,
      errorMessage: capStoredErrorMessage(input.errorMessage),
    });
  }, timeoutMs);
}
