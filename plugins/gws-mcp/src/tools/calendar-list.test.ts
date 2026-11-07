import { describe, expect, it } from "vitest";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { handleCalendar } from "./calendar.js";

/* SCRUM-474: calendar_list_events reads a change feed. Each new parameter
 * reaches the query exactly when it is given, and the list is otherwise the
 * request it always was. */

async function list(args: Record<string, unknown>, items: unknown[] = []) {
  const { client, calls } = fakeClient([{ data: { summary: "Cal", timeZone: "UTC", items } }]);
  const result = await handleCalendar(client, "calendar_list_events", args);
  return { params: calls[0]?.params as Record<string, unknown>, result, calls };
}

describe("calendar_list_events change-feed parameters (SCRUM-474)", () => {
  it("with none of them, the request is the one it was", async () => {
    const { params } = await list({ time_min: "2026-01-01T00:00:00Z", time_max: "2026-01-08T00:00:00Z" });
    expect(params).toEqual({
      calendarId: "primary",
      timeMin: "2026-01-01T00:00:00Z",
      timeMax: "2026-01-08T00:00:00Z",
      maxResults: 20,
      singleEvents: true,
      orderBy: "startTime",
    });
  });

  it("updated_min goes out as updatedMin", async () => {
    const { params } = await list({ updated_min: "2026-01-01T00:00:00Z" });
    expect(params.updatedMin).toBe("2026-01-01T00:00:00Z");
    expect(params).not.toHaveProperty("showDeleted");
  });

  it("show_deleted goes out as showDeleted, false as well as true", async () => {
    expect((await list({ show_deleted: true })).params.showDeleted).toBe(true);
    expect((await list({ show_deleted: false })).params.showDeleted).toBe(false);
  });

  it("order_by updated replaces the default order, and singleEvents stays true", async () => {
    const { params } = await list({ order_by: "updated" });
    expect(params.orderBy).toBe("updated");
    expect(params.singleEvents).toBe(true);
  });

  it("an order_by Google does not take is refused before any request", async () => {
    const { client, calls } = fakeClient([]);
    await expect(handleCalendar(client, "calendar_list_events", { order_by: "created" })).rejects.toThrow(
      /order_by must be "startTime" or "updated"/
    );
    expect(calls).toHaveLength(0);
  });

  it("a deleted event comes back with its status, in the usual compact shape", async () => {
    const { result } = await list({ show_deleted: true }, [
      { id: "e1", summary: "Kept", status: "confirmed", start: { dateTime: "x" }, end: { dateTime: "y" } },
      { id: "e2", status: "cancelled" },
    ]);
    const events = payload(result).events as Array<Record<string, unknown>>;
    expect(events[0]).not.toHaveProperty("status");
    expect(events[1]).toMatchObject({ id: "e2", status: "cancelled" });
  });
});
