/**
 * Whether the scheduling feature (SCRUM-225) is visible in the UI.
 *
 * Hidden per SCRUM-239: the feature shipped before it was designed, so every
 * user-facing affordance is off (the Schedule control on a card, the
 * Schedules section, the "schedule it" copy). Everything behind it stays as
 * built and tested: the tables, the routes (unreachable from the UI), the
 * per-minute claimer (a no-op with no schedules), the trigger property.
 *
 * Revealing it is this one line. Nothing else changes.
 */
export const SCHEDULING_UI = false;
