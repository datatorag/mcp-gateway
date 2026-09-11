/** How a token count and a cost read on the product's surfaces (SCRUM-257):
 * the thread's run summary line and the usage dashboard say the same thing
 * the same way. Pure, so both bundles can import it. */

/** "184k tokens", "4.5k tokens", "900 tokens". */
export function formatTokens(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  if (n < 1000) return `${n} tokens`;
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k tokens`;
  return `${Math.round(n / 1000)}k tokens`;
}

/** "about $0.99", "under $0.01", or null when the run had no price. */
export function formatCost(costUsd: number | null): string | null {
  if (costUsd === null || !Number.isFinite(costUsd)) return null;
  if (costUsd > 0 && costUsd < 0.01) return "under $0.01";
  return `about $${costUsd.toFixed(2)}`;
}
