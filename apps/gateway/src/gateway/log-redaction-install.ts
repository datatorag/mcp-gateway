/**
 * Imported for its effect, FIRST, by the server's entry point: the rule in
 * `log-redaction.ts` is on the process before anything else has a chance to
 * write.
 */
import { installLogRedaction } from "./log-redaction";

installLogRedaction();
