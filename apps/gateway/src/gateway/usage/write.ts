import type { Database } from "@datatorag-mcp/db";
import { usageEvents } from "@datatorag-mcp/db";
import { redactErrorMessage } from "./redact";
import type { OutcomeStatus } from "./classify";

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
      errorMessage: redactErrorMessage(input.errorMessage),
    });
  }, timeoutMs);
}
