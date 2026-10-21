/* Shape from Notion's API reference, not recorded. Notion's error envelope is
 * {object: "error", status, code, message}; the bodies below fill it with the
 * codes the reference lists. The 429's code and its Retry-After header of 16
 * were observed on 2026-10-21; its message text was not kept, so it is
 * written here. The 529 is Notion's overloaded answer; its code is an
 * assumption, and nothing in the client reads it. */

export const UNAUTHORIZED = {
  object: "error",
  status: 401,
  code: "unauthorized",
  message: "API token is invalid.",
};

export const RATE_LIMITED = {
  object: "error",
  status: 429,
  code: "rate_limited",
  message: "You have been rate limited. Please try again in a few minutes.",
};

export const OVERLOADED = {
  object: "error",
  status: 529,
  code: "service_unavailable",
  message: "Notion is unavailable. Please try again later.",
};

export const SERVICE_UNAVAILABLE = {
  object: "error",
  status: 503,
  code: "service_unavailable",
  message: "Notion is unavailable, this can occur when the time to respond to a request takes longer than 60 seconds.",
};
