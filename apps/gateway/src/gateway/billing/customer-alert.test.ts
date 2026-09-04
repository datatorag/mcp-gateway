import { describe, it, expect, vi, beforeEach } from "vitest";
import type Stripe from "stripe";
import type { Database } from "@datatorag-mcp/db";

vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({
    INTERNAL_EXCLUDE_EMAILS: "founder@example.com",
    STRIPE_PRO_MONTHLY_PRICE_ID: "price_monthly_test",
    STRIPE_PRO_YEARLY_PRICE_ID: "price_yearly_test",
  }),
}));
vi.mock("../../lib/slack", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import { newCustomerFromEvent, notifyNewCustomer } from "./customer-alert";
import { sendSlack } from "../../lib/slack";

/* SCRUM-212: the #leads alert fires on the PAYMENT, never on the intent.
 *
 * `customer.created` is emitted by our own checkout route the moment checkout
 * BEGINS, so an alert on it would post for every abandoned checkout, which is
 * exactly the mistake the digest made (SCRUM-211). `customer.subscription.
 * created` with an active status is the event that means money changed
 * hands for a subscription, and it fires once per subscription rather than
 * once per renewal, so it is the one that means "new customer". */

function subscriptionEvent(args: {
  type: string;
  status: Stripe.Subscription.Status;
  customer?: string;
  metadataUserId?: string;
  unitAmount?: number | null;
  interval?: string;
  priceId?: string;
}): Stripe.Event {
  return {
    id: "evt_1",
    type: args.type,
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        customer: args.customer ?? "cus_1",
        status: args.status,
        metadata: args.metadataUserId ? { user_id: args.metadataUserId } : {},
        items: {
          data: [
            {
              price: {
                id: args.priceId ?? "price_monthly_test",
                unit_amount: args.unitAmount === undefined ? 2900 : args.unitAmount,
                currency: "usd",
                recurring: { interval: args.interval ?? "month" },
              },
            },
          ],
        },
      },
    },
  } as unknown as Stripe.Event;
}

describe("newCustomerFromEvent: which Stripe event means a new customer", () => {
  it("is customer.subscription.created with an active status", () => {
    const nc = newCustomerFromEvent(
      subscriptionEvent({ type: "customer.subscription.created", status: "active" })
    );
    expect(nc).toEqual({
      customerId: "cus_1",
      metadataUserId: undefined,
      subscriptionId: "sub_1",
      priceId: "price_monthly_test",
      amountCents: 2900,
      currency: "usd",
      interval: "month",
    });
  });

  it("is NOT customer.created: that is checkout starting, our own route emits it", () => {
    const event = {
      id: "evt_2",
      type: "customer.created",
      data: { object: { id: "cus_1", object: "customer", email: "a@example.com" } },
    } as unknown as Stripe.Event;
    expect(newCustomerFromEvent(event)).toBeNull();
  });

  it("is NOT a subscription update or deletion, which fire on renewals and churn", () => {
    expect(
      newCustomerFromEvent(
        subscriptionEvent({ type: "customer.subscription.updated", status: "active" })
      )
    ).toBeNull();
    expect(
      newCustomerFromEvent(
        subscriptionEvent({ type: "customer.subscription.deleted", status: "canceled" })
      )
    ).toBeNull();
  });

  it("is NOT a subscription created in a non-paying status", () => {
    expect(
      newCustomerFromEvent(
        subscriptionEvent({ type: "customer.subscription.created", status: "incomplete" })
      )
    ).toBeNull();
  });
});

// notifyNewCustomer reads the user by customer id (select().from().where().limit()).
const userLimit = vi.fn();
const dbMock = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: userLimit }),
    }),
  }),
} as unknown as Database;

const CUSTOMER = {
  customerId: "cus_1",
  metadataUserId: undefined,
  subscriptionId: "sub_1",
  priceId: "price_monthly_test",
  amountCents: 2900,
  currency: "usd",
  interval: "month",
};

const USER_ROW = {
  id: "u1",
  email: "new-customer@example.com",
  name: "New Customer",
  acquisitionChannel: "paid_search",
  acquisitionUtmSource: "google",
  acquisitionUtmMedium: "cpc",
  acquisitionUtmCampaign: "launch",
  acquisitionGclid: null,
  acquisitionReferringDomain: null,
};

function lastText(): string {
  return vi.mocked(sendSlack).mock.calls[0][1].text;
}

describe("notifyNewCustomer: the #leads post carries what a reader needs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userLimit.mockResolvedValue([USER_ROW]);
  });

  it("names the email, the plan, the amount and the source, on the leads channel", async () => {
    await notifyNewCustomer(dbMock, CUSTOMER);
    expect(sendSlack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSlack).mock.calls[0][0]).toBe("leads");
    const text = lastText();
    expect(text).toContain("New customer");
    expect(text).toContain("new-customer@example.com");
    expect(text).toContain("Pro monthly");
    expect(text).toContain("$29.00/month");
    expect(text).toContain("Source: paid_search - google / cpc / campaign launch");
  });

  it("labels the yearly price and formats the amount from cents", async () => {
    await notifyNewCustomer(dbMock, {
      ...CUSTOMER,
      priceId: "price_yearly_test",
      amountCents: 29000,
      interval: "year",
    });
    const text = lastText();
    expect(text).toContain("Pro yearly");
    expect(text).toContain("$290.00/year");
  });

  it("says so when the price is one we do not recognise, and when the amount is missing", async () => {
    await notifyNewCustomer(dbMock, {
      ...CUSTOMER,
      priceId: "price_unknown",
      amountCents: null,
      currency: null,
      interval: null,
    });
    const text = lastText();
    expect(text).toContain("price_unknown");
    expect(text).toContain("amount unknown");
  });

  it("states missing attribution explicitly rather than leaving a blank", async () => {
    userLimit.mockResolvedValue([
      {
        ...USER_ROW,
        acquisitionChannel: null,
        acquisitionUtmSource: null,
        acquisitionUtmMedium: null,
        acquisitionUtmCampaign: null,
      },
    ]);
    await notifyNewCustomer(dbMock, CUSTOMER);
    expect(lastText()).toContain("Source: unknown (no acquisition data captured)");
  });

  it("skips internal accounts, so founder dogfooding never reads as revenue", async () => {
    userLimit.mockResolvedValue([{ ...USER_ROW, email: "founder@example.com" }]);
    await notifyNewCustomer(dbMock, CUSTOMER);
    expect(sendSlack).not.toHaveBeenCalled();
  });

  it("posts with the customer id when no user matches, rather than staying silent", async () => {
    // A paying customer we cannot resolve is the loudest possible signal that
    // the customer link is broken; silence would hide a real payment.
    userLimit.mockResolvedValue([]);
    await notifyNewCustomer(dbMock, CUSTOMER);
    expect(sendSlack).toHaveBeenCalledTimes(1);
    expect(lastText()).toContain("cus_1");
    expect(lastText()).toContain("no matching user");
  });

  it("never throws, even if the lookup does", async () => {
    userLimit.mockRejectedValue(new Error("db down"));
    await expect(notifyNewCustomer(dbMock, CUSTOMER)).resolves.toBeUndefined();
  });
});
