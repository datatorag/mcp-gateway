/**
 * Approval policy for a SKILL RUN (SCRUM-223, SCRUM-225).
 *
 * Per HQ decision: a skill run is a background process. It prompts for
 * nothing mid-run, manual or scheduled, reads and writes alike. Consent is
 * the Run click or the schedule save, given once, before the run starts.
 * Safety moved from gates to ORDERING (reversible before irreversible, the
 * pattern every published skill teaches: label before mark-read) and to
 * RECOVERY (a history of what each run touched, a one-click pause, an
 * automatic pause after consecutive failures, one email on pause).
 *
 * This is deliberately the ONE place that says so. `wrapMcpTools` consults it
 * only when the request is a skill run; an ordinary agent turn keeps the
 * write gate exactly as it was (`requireApprovalFor`). If a gate is ever
 * reinstated, it is argued for here and nowhere else.
 */
export function skillRunApproval(_toolName: string): boolean {
  return false;
}
