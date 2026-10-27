import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { Database } from "@datatorag-mcp/db";
import { stripeEvents, subscriptions, users } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "@/test-utils/db";
import { handleStripeEvent } from "./webhook-handlers";

const capture = vi.fn();
vi.mock("../../lib/posthog-server", () => ({ getPosthog: () => ({ capture }) }));

// REAL POSTGRES ON PURPOSE. The idempotency guard IS an ON CONFLICT insert
// inside a transaction, and the rollback-on-failure behaviour IS transaction
// semantics — a chainable vi.fn() stub would "pass" no matter what the SQL
// does, which is exactly the class of decorative check this suite exists to
// avoid. Docker-optional, same gating convention as route.liveness.test.ts.
const dockerAvailable = isDockerAvailable();

let db: Database;

function subscriptionEvent(args: {
  eventId: string;
  type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted";
  subscriptionId: string;
  customerId: string;
  status: Stripe.Subscription.Status;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  metadataUserId?: string;
  interval?: "month" | "year";
  previous?: Record<string, unknown>;
}): Stripe.Event {
  const periodStart = Math.floor(Date.now() / 1000) - 60;
  return {
    id: args.eventId,
    type: args.type,
    data: {
      object: {
        id: args.subscriptionId,
        object: "subscription",
        customer: args.customerId,
        status: args.status,
        cancel_at_period_end: args.cancelAtPeriodEnd ?? false,
        cancel_at: args.cancelAt ?? null,
        metadata: args.metadataUserId ? { user_id: args.metadataUserId } : {},
        items: {
          data: [
            {
              current_period_start: periodStart,
              current_period_end: periodStart + 30 * 24 * 3600,
              price: { id: "price_test_monthly", recurring: { interval: args.interval ?? "month" } },
            },
          ],
        },
      },
      ...(args.previous ? { previous_attributes: args.previous } : {}),
    },
  } as unknown as Stripe.Event;
}

async function planOf(userId: string): Promise<string> {
  const [row] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId));
  return row.plan;
}

async function linkCustomer(userId: string, customerId: string): Promise<void> {
  await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));
}

describe.skipIf(!dockerAvailable)("stripe webhook handlers (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  it("subscription.created (active) flips the user to pro and records the subscription", async () => {
    const userId = await insertTestUser(db);
    const cus = `cus_${randomUUID().slice(0, 8)}`;
    await linkCustomer(userId, cus);
    expect(await planOf(userId)).toBe("free"); // the new column default

    const outcome = await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.created",
        subscriptionId: `sub_${randomUUID().slice(0, 8)}`,
        customerId: cus,
        status: "active",
      })
    );
    expect(outcome).toEqual({ duplicate: false, action: "subscription active → plan pro" });
    expect(await planOf(userId)).toBe("pro");
  });

  it("REPLAYED EVENT IS A NO-OP: the second delivery applies nothing, even if state moved on", async () => {
    const userId = await insertTestUser(db);
    const cus = `cus_${randomUUID().slice(0, 8)}`;
    await linkCustomer(userId, cus);
    const event = subscriptionEvent({
      eventId: `evt_${randomUUID()}`,
      type: "customer.subscription.created",
      subscriptionId: `sub_${randomUUID().slice(0, 8)}`,
      customerId: cus,
      status: "active",
    });

    const first = await handleStripeEvent(db, event);
    expect(first.duplicate).toBe(false);
    expect(await planOf(userId)).toBe("pro");

    // Move the world on: the user has since been downgraded (say, a payment
    // failed). A replay of the OLD event must not resurrect Pro — that is
    // what "no-op" means, not merely "writes the same values again".
    await db.update(users).set({ plan: "free" }).where(eq(users.id, userId));

    const second = await handleStripeEvent(db, event);
    expect(second).toEqual({ duplicate: true });
    expect(await planOf(userId)).toBe("free");
  });

  it("cancel_at_period_end keeps Pro until the period ends; deletion ends it", async () => {
    const userId = await insertTestUser(db);
    const cus = `cus_${randomUUID().slice(0, 8)}`;
    const sub = `sub_${randomUUID().slice(0, 8)}`;
    await linkCustomer(userId, cus);

    await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.created",
        subscriptionId: sub,
        customerId: cus,
        status: "active",
      })
    );
    // User cancels: Stripe keeps the subscription ACTIVE with
    // cancel_at_period_end until the paid-through date.
    await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.updated",
        subscriptionId: sub,
        customerId: cus,
        status: "active",
        cancelAtPeriodEnd: true,
      })
    );
    expect(await planOf(userId)).toBe("pro"); // access lasts to period end
    const [row] = await db
      .select({ cape: subscriptions.cancelAtPeriodEnd, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, sub));
    expect(row).toEqual({ cape: true, status: "active" });

    // Period end arrives: Stripe deletes the subscription.
    await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.deleted",
        subscriptionId: sub,
        customerId: cus,
        status: "canceled",
      })
    );
    expect(await planOf(userId)).toBe("free");
  });

  it("a failed payment does NOT silently leave the user on Pro — and a recovered payment restores it", async () => {
    const userId = await insertTestUser(db);
    const cus = `cus_${randomUUID().slice(0, 8)}`;
    const sub = `sub_${randomUUID().slice(0, 8)}`;
    await linkCustomer(userId, cus);
    await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.created",
        subscriptionId: sub,
        customerId: cus,
        status: "active",
      })
    );
    expect(await planOf(userId)).toBe("pro");

    const failedInvoice = {
      id: `evt_${randomUUID()}`,
      type: "invoice.payment_failed",
      data: {
        object: {
          id: `in_${randomUUID().slice(0, 8)}`,
          object: "invoice",
          customer: cus,
          parent: { subscription_details: { subscription: sub } },
        },
      },
    } as unknown as Stripe.Event;
    const outcome = await handleStripeEvent(db, failedInvoice);
    expect(outcome).toEqual({ duplicate: false, action: "payment failed → plan free" });
    expect(await planOf(userId)).toBe("free");
    const [row] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.stripeSubscriptionId, sub));
    expect(row.status).toBe("past_due");

    // Stripe's retry collects: subscription.updated arrives with status
    // active again, and Pro comes back without human intervention.
    await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.updated",
        subscriptionId: sub,
        customerId: cus,
        status: "active",
      })
    );
    expect(await planOf(userId)).toBe("pro");
  });

  it("checkout.session.completed backfills the customer link and never touches plan", async () => {
    const userId = await insertTestUser(db);
    const cus = `cus_${randomUUID().slice(0, 8)}`;
    const event = {
      id: `evt_${randomUUID()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${randomUUID().slice(0, 8)}`,
          object: "checkout.session",
          mode: "subscription",
          client_reference_id: userId,
          customer: cus,
        },
      },
    } as unknown as Stripe.Event;
    const outcome = await handleStripeEvent(db, event);
    expect(outcome).toEqual({ duplicate: false, action: "checkout completed" });
    const [row] = await db
      .select({ cus: users.stripeCustomerId, plan: users.plan })
      .from(users)
      .where(eq(users.id, userId));
    // Plan untouched: the subscription events own it, so delivery order
    // between checkout.session.completed and subscription.created is moot.
    expect(row).toEqual({ cus, plan: "free" });
  });

  it("a subscription for an unknown customer is acknowledged without touching anyone", async () => {
    const outcome = await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.created",
        subscriptionId: `sub_${randomUUID().slice(0, 8)}`,
        customerId: `cus_${randomUUID().slice(0, 8)}`,
        status: "active",
      })
    );
    expect(outcome).toEqual({ duplicate: false, action: "unknown-customer" });
  });

  it("a handler failure rolls back its event claim, so Stripe's retry is processed fresh", async () => {
    const userId = await insertTestUser(db);
    const cus = `cus_${randomUUID().slice(0, 8)}`;
    await linkCustomer(userId, cus);
    const eventId = `evt_${randomUUID()}`;
    const subId = `sub_${randomUUID().slice(0, 8)}`;

    // Malformed on purpose: no subscription items, so the period read throws
    // mid-transaction, AFTER the event id was claimed.
    const broken = {
      id: eventId,
      type: "customer.subscription.created",
      data: {
        object: {
          id: subId,
          object: "subscription",
          customer: cus,
          status: "active",
          cancel_at_period_end: false,
          metadata: {},
          items: { data: [] },
        },
      },
    } as unknown as Stripe.Event;
    await expect(handleStripeEvent(db, broken)).rejects.toThrow();

    // The claim must have rolled back with the failure — otherwise the retry
    // below would be swallowed as a duplicate and the event lost forever.
    const claims = await db
      .select({ id: stripeEvents.id })
      .from(stripeEvents)
      .where(eq(stripeEvents.id, eventId));
    expect(claims).toEqual([]);

    // Stripe redelivers the same event id, now well-formed: it processes.
    const retried = await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId,
        type: "customer.subscription.created",
        subscriptionId: subId,
        customerId: cus,
        status: "active",
      })
    );
    expect(retried.duplicate).toBe(false);
    expect(await planOf(userId)).toBe("pro");
  });

  it("resolves the user from subscription metadata when the customer link is missing", async () => {
    const userId = await insertTestUser(db);
    const outcome = await handleStripeEvent(
      db,
      subscriptionEvent({
        eventId: `evt_${randomUUID()}`,
        type: "customer.subscription.created",
        subscriptionId: `sub_${randomUUID().slice(0, 8)}`,
        customerId: `cus_${randomUUID().slice(0, 8)}`, // not linked to anyone
        status: "active",
        metadataUserId: userId,
      })
    );
    expect(outcome.duplicate).toBe(false);
    expect(await planOf(userId)).toBe("pro");
  });
});

/* SCRUM-144: the subscription lifecycle into PostHog. Real Postgres for the
 * same reason as above: "first time only" and "nothing on a replay" are both
 * decided by rows and by the transaction. */
describe.skipIf(!dockerAvailable)("subscription events (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });
  beforeEach(() => {
    capture.mockClear();
  });

  async function customer() {
    const userId = await insertTestUser(db);
    const cus = `cus_${randomUUID().slice(0, 8)}`;
    await linkCustomer(userId, cus);
    return { userId, cus, sub: `sub_${randomUUID().slice(0, 8)}` };
  }

  type Args = Parameters<typeof subscriptionEvent>[0];
  function send(c: { cus: string; sub: string }, args: Omit<Args, "eventId" | "subscriptionId" | "customerId">) {
    return handleStripeEvent(
      db,
      subscriptionEvent({ eventId: `evt_${randomUUID()}`, subscriptionId: c.sub, customerId: c.cus, ...args })
    );
  }
  const sent = () => capture.mock.calls.map(([e]) => e);

  it("subscription_started: a first subscription created active, distinct id the user, plan and interval only", async () => {
    const c = await customer();
    await send(c, { type: "customer.subscription.created", status: "active", interval: "year" });
    expect(sent()).toEqual([
      { distinctId: c.userId, event: "subscription_started", properties: { plan: "pro", interval: "year" } },
    ]);
  });

  it("subscription_started: an incomplete checkout that was paid", async () => {
    const c = await customer();
    await send(c, { type: "customer.subscription.created", status: "incomplete" });
    expect(sent()).toEqual([]);
    await send(c, { type: "customer.subscription.updated", status: "active", previous: { status: "incomplete" } });
    expect(sent().map((e) => e.event)).toEqual(["subscription_started"]);
  });

  it("is not started again: a replay, a recovery from past_due, or a second subscription", async () => {
    const c = await customer();
    const event = subscriptionEvent({
      eventId: `evt_${randomUUID()}`,
      type: "customer.subscription.created",
      subscriptionId: c.sub,
      customerId: c.cus,
      status: "active",
    });
    await handleStripeEvent(db, event);
    await handleStripeEvent(db, event);
    await send(c, { type: "customer.subscription.updated", status: "active", previous: { status: "past_due" } });
    await send({ cus: c.cus, sub: `sub_${randomUUID().slice(0, 8)}` }, { type: "customer.subscription.created", status: "active" });
    expect(sent().map((e) => e.event)).toEqual(["subscription_started"]);
  });

  it("subscription_changed: the interval moved", async () => {
    const c = await customer();
    await send(c, { type: "customer.subscription.created", status: "active" });
    capture.mockClear();
    await send(c, {
      type: "customer.subscription.updated",
      status: "active",
      interval: "year",
      previous: { items: { data: [{ price: { id: "price_test_monthly", recurring: { interval: "month" } } }] } },
    });
    expect(sent()).toEqual([
      { distinctId: c.userId, event: "subscription_changed", properties: { plan: "pro", interval: "year" } },
    ]);
  });

  it("an update that moved neither interval nor cancellation sends nothing", async () => {
    const c = await customer();
    await send(c, { type: "customer.subscription.created", status: "active" });
    capture.mockClear();
    await send(c, { type: "customer.subscription.updated", status: "active", previous: { metadata: {} } });
    expect(sent()).toEqual([]);
  });

  it("subscription_cancelled: at period end by the boolean, or by cancel_at as the portal sends it", async () => {
    const a = await customer();
    await send(a, { type: "customer.subscription.created", status: "active" });
    capture.mockClear();
    await send(a, {
      type: "customer.subscription.updated",
      status: "active",
      cancelAtPeriodEnd: true,
      previous: { cancel_at_period_end: false },
    });
    const b = await customer();
    await send(b, { type: "customer.subscription.created", status: "active" });
    await send(b, {
      type: "customer.subscription.updated",
      status: "active",
      cancelAt: Math.floor(Date.now() / 1000) + 86400,
      previous: { cancel_at: null },
    });
    expect(sent().filter((e) => e.event === "subscription_cancelled").map((e) => e.distinctId)).toEqual([a.userId, b.userId]);
  });

  it("subscription_ended: a scheduled cancellation reaching its end sends ended alone", async () => {
    const c = await customer();
    await send(c, { type: "customer.subscription.created", status: "active" });
    capture.mockClear();
    await send(c, { type: "customer.subscription.deleted", status: "canceled", cancelAtPeriodEnd: true });
    expect(sent()).toEqual([
      { distinctId: c.userId, event: "subscription_ended", properties: { plan: "pro", interval: "month" } },
    ]);
  });

  it("an immediate cancel sends cancelled, then ended", async () => {
    const c = await customer();
    await send(c, { type: "customer.subscription.created", status: "active" });
    capture.mockClear();
    await send(c, { type: "customer.subscription.deleted", status: "canceled" });
    expect(sent().map((e) => e.event)).toEqual(["subscription_cancelled", "subscription_ended"]);
  });

  it("a delivery that rolled back sends nothing; its retry sends once", async () => {
    const c = await customer();
    const eventId = `evt_${randomUUID()}`;
    const broken = {
      id: eventId,
      type: "customer.subscription.created",
      data: {
        object: { id: c.sub, object: "subscription", customer: c.cus, status: "active", cancel_at_period_end: false, metadata: {}, items: { data: [] } },
      },
    } as unknown as Stripe.Event;
    await expect(handleStripeEvent(db, broken)).rejects.toThrow();
    expect(sent()).toEqual([]);
    await handleStripeEvent(
      db,
      subscriptionEvent({ eventId, type: "customer.subscription.created", subscriptionId: c.sub, customerId: c.cus, status: "active" })
    );
    expect(sent().map((e) => e.event)).toEqual(["subscription_started"]);
  });
});
