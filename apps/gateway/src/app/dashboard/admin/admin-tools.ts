/** The admin tools the admin index lists, one line each (SCRUM-487).
 *
 * In its own module because a Next.js page file may export only the fields
 * Next defines for a page; any other export fails the production build. */
export const ADMIN_TOOLS = [
  {
    href: "/dashboard/admin/tests",
    label: "Test runner",
    description: "Run the smoke cases against this deployment and read past runs.",
  },
] as const;
