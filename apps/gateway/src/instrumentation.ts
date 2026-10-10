import type { Instrumentation } from "next";

/**
 * The framework's hook for an error in a server render or a route handler
 * (SCRUM-407). It is the only place such an error can be reported from: the
 * browser is never shown it. What is sent, and what is not, is decided in
 * lib/request-error-report.ts.
 *
 * The analytics client is imported inside the hook, and only on the Node
 * runtime, so nothing here is pulled into a bundle that cannot run it.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getPosthog }, { reportRequestError }] = await Promise.all([
    import("@/lib/posthog-server"),
    import("@/lib/request-error-report"),
  ]);
  reportRequestError(getPosthog(), error, request, context);
};
