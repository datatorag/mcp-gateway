export const DEFAULT_SERVICES = "drive,gmail,sheets,calendar,docs,slides,people,tasks";

// The gws binary's -s picker maps each service to fixed scopes and has no way
// to add extras (--scopes REPLACES the service-derived list), so we own the map
// and state each service's scopes explicitly. Keep in sync with the binary's
// picker; unknown services fall back to -s.
//
// gmail deliberately does NOT request settings.basic. It was here for the
// filter create/delete tools, which are withheld until that scope is granted —
// asking a self-hosted user to consent to writing their mail settings buys
// nothing while no tool can use it. Restore it when those tools return.
const SERVICE_SCOPES: Record<string, string[]> = {
  drive: ["https://www.googleapis.com/auth/drive"],
  sheets: ["https://www.googleapis.com/auth/spreadsheets"],
  gmail: ["https://www.googleapis.com/auth/gmail.modify"],
  calendar: ["https://www.googleapis.com/auth/calendar"],
  docs: ["https://www.googleapis.com/auth/documents"],
  slides: ["https://www.googleapis.com/auth/presentations"],
  tasks: ["https://www.googleapis.com/auth/tasks"],
  people: [
    "https://www.googleapis.com/auth/contacts",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/directory.readonly",
    "https://www.googleapis.com/auth/user.addresses.read",
    "https://www.googleapis.com/auth/user.birthday.read",
    "https://www.googleapis.com/auth/user.emails.read",
    "https://www.googleapis.com/auth/user.gender.read",
    "https://www.googleapis.com/auth/user.organization.read",
    "https://www.googleapis.com/auth/user.phonenumbers.read",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
};

// One keyword per DEFAULT_SERVICES entry, matched as a substring of the
// granted scope URLs so short forms match too. Lives here, next to
// SERVICE_SCOPES, because the two lists mirror each other: a service added
// above needs its keyword added here or the re-auth check won't ask for it.
export const REQUIRED_SCOPE_KEYWORDS = [
  "drive",
  "gmail",
  "calendar",
  "documents",
  "spreadsheets",
  "presentations",
  "contacts",
  "tasks",
];

/**
 * Resolve service names to explicit OAuth scopes (the binary appends
 * openid/userinfo.email itself). Returns undefined if any service is unknown,
 * so callers can fall back to the binary's own -s picker.
 */
export function scopesForServices(services: string): string[] | undefined {
  const out: string[] = [];
  for (const name of services.split(",").map((s) => s.trim()).filter(Boolean)) {
    const scopes = SERVICE_SCOPES[name];
    if (!scopes) return undefined;
    out.push(...scopes);
  }
  return [...new Set(out)];
}
