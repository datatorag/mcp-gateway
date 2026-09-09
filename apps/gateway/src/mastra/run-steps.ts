/**
 * How many model calls one turn may make (SCRUM-234). A step is one model
 * call, which may carry several parallel tool calls.
 *
 * The runtime's own default is five per turn when nothing sets it, and it
 * ends the turn SILENTLY after the fifth step's tool results: a real
 * morning brief made eight tool calls in five steps and stopped with no
 * label, no task, no brief and no notice. So the budget is ours, sized for
 * the run, and the chat route turns a stop into a notice (see
 * `data-run-stopped` in the chat route).
 *
 * Sixty for a skill run: a brief on one account is about a dozen calls; the
 * per-account steps (calendar, search, read a few, label, tasks) multiply
 * by the accounts connected, and the account that failed has seven. Sixty
 * covers a seven-account brief with room for the retries the model makes,
 * and it is a ceiling against a runaway loop, not a target. Cost is
 * bounded separately by RUN_TOKEN_CEILING, which binds first until the
 * per-step prefix shrinks (SCRUM-238).
 *
 * Twelve for chat: an ordinary question rarely needs more than a few
 * tool calls, and a chat turn that wants sixty steps is a skill that
 * should be seeded as one.
 */
export const SKILL_RUN_MAX_STEPS = 60;
export const CHAT_MAX_STEPS = 12;
