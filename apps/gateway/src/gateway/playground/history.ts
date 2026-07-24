import type { ModelMessage } from "ai";

/**
 * Rebuilds the model conversation from client-supplied UIMessages as
 * TEXT-ONLY history (the successor of the old client's buildApiMessages):
 * only user/assistant roles, only text parts, assistant messages with no
 * text (errored/aborted turns) dropped. Tool and data parts are discarded —
 * nothing in client history is ever executed or replayed to the model.
 * Returns null on a malformed payload (route maps that to 400).
 */
export function buildModelHistory(messages: unknown): ModelMessage[] | null {
  if (!Array.isArray(messages)) return null;
  const out: ModelMessage[] = [];
  for (const m of messages) {
    const msg = m as { role?: unknown; parts?: unknown };
    if (msg?.role !== "user" && msg?.role !== "assistant") continue;
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    const text = parts
      .filter((p): p is { type: string; text: string } =>
        (p as { type?: unknown })?.type === "text" &&
        typeof (p as { text?: unknown }).text === "string")
      .map((p) => p.text)
      .join("");
    if (msg.role === "assistant" && !text.trim()) continue;
    out.push({ role: msg.role, content: text });
  }
  const last = out[out.length - 1];
  if (!last || last.role !== "user" || !String(last.content).trim()) return null;
  return out;
}
