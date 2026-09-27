import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { loadBillingDetails } from "./billing-details";

/** A fake Stripe with only the three READ methods the Billing page may call.
 * Anything else it is asked for is undefined, so a write would throw. */
function fakeStripe(over: {
  customer?: unknown;
  listedCards?: unknown[];
  invoices?: unknown[];
  delay?: number;
  fail?: boolean;
} = {}) {
  const wait = <T,>(v: T) =>
    over.fail
      ? Promise.reject(new Error("stripe down"))
      : new Promise<T>((r) => setTimeout(() => r(v), over.delay ?? 0));
  const calls: string[] = [];
  const stripe = {
    customers: {
      retrieve: vi.fn((id: string, opts: unknown) => {
        calls.push(`customers.retrieve ${id} ${JSON.stringify(opts)}`);
        return wait(over.customer ?? { id, invoice_settings: { default_payment_method: null } });
      }),
    },
    paymentMethods: {
      list: vi.fn((params: unknown) => {
        calls.push(`paymentMethods.list ${JSON.stringify(params)}`);
        return wait({ data: over.listedCards ?? [] });
      }),
    },
    invoices: {
      list: vi.fn((params: unknown) => {
        calls.push(`invoices.list ${JSON.stringify(params)}`);
        return wait({ data: over.invoices ?? [] });
      }),
    },
  };
  return { stripe: stripe as unknown as Stripe, calls };
}

const card = (last4: string) => ({ id: `pm_${last4}`, type: "card", card: { brand: "visa", last4, exp_month: 4, exp_year: 2029 } });

describe("loadBillingDetails (SCRUM-352)", () => {
  it("reads the customer's default card and the last five invoices, and only reads", async () => {
    const { stripe, calls } = fakeStripe({
      customer: { id: "cus_1", invoice_settings: { default_payment_method: card("4242") } },
      invoices: [
        { id: "in_1", created: 1_790_000_000, status: "paid", amount_paid: 2000, total: 2000, currency: "usd", invoice_pdf: "https://pay.stripe.com/invoice/a/pdf" },
      ],
    });
    const d = await loadBillingDetails("cus_1", stripe);
    expect(d.paymentMethod).toEqual({ ok: true, value: { type: "card", brand: "visa", last4: "4242", expMonth: 4, expYear: 2029 } });
    expect(d.invoices).toEqual({
      ok: true,
      value: [{ id: "in_1", created: new Date(1_790_000_000_000), amount: 2000, currency: "usd", status: "paid", pdfUrl: "https://pay.stripe.com/invoice/a/pdf" }],
    });
    expect(calls).toEqual([
      'customers.retrieve cus_1 {"expand":["invoice_settings.default_payment_method"]}',
      'invoices.list {"customer":"cus_1","limit":5}',
    ]);
  });

  it("falls back to the customer's attached card when no default is set, and to null with none", async () => {
    const withCard = fakeStripe({ listedCards: [card("1111")] });
    expect((await loadBillingDetails("cus_1", withCard.stripe)).paymentMethod).toMatchObject({ ok: true, value: { last4: "1111" } });
    expect(withCard.calls).toContain('paymentMethods.list {"customer":"cus_1","type":"card","limit":1}');
    const none = fakeStripe();
    expect((await loadBillingDetails("cus_1", none.stripe)).paymentMethod).toEqual({ ok: true, value: null });
  });

  it("a deleted customer has no payment method", async () => {
    const { stripe } = fakeStripe({ customer: { id: "cus_1", deleted: true } });
    expect((await loadBillingDetails("cus_1", stripe)).paymentMethod).toEqual({ ok: true, value: null });
  });

  it("keeps a PDF link only when it is Stripe-hosted", async () => {
    const { stripe } = fakeStripe({
      invoices: [
        { id: "in_1", created: 1, status: "open", amount_paid: 0, total: 2000, currency: "usd", invoice_pdf: "https://evil.example.com/x.pdf" },
        { id: "in_2", created: 2, status: "paid", amount_paid: 2000, total: 2000, currency: "usd", invoice_pdf: null },
      ],
    });
    const d = await loadBillingDetails("cus_1", stripe);
    expect(d.invoices.ok && d.invoices.value.map((i) => i.pdfUrl)).toEqual([null, null]);
    // An unpaid invoice shows what it is for, a paid one what was paid.
    expect(d.invoices.ok && d.invoices.value.map((i) => i.amount)).toEqual([2000, 2000]);
  });

  it("Stripe failing or slow degrades each half on its own, and never throws", async () => {
    const down = fakeStripe({ fail: true });
    expect(await loadBillingDetails("cus_1", down.stripe)).toEqual({ paymentMethod: { ok: false }, invoices: { ok: false } });
    const slow = fakeStripe({ delay: 50 });
    expect(await loadBillingDetails("cus_1", slow.stripe, 5)).toEqual({ paymentMethod: { ok: false }, invoices: { ok: false } });
  });

  it("no Stripe key configured is the same degrade, not a crash", async () => {
    vi.resetModules();
    vi.doMock("@/lib/stripe", () => ({
      getStripe: () => {
        throw new Error("STRIPE_API_KEY not configured");
      },
    }));
    const { loadBillingDetails: load } = await import("./billing-details");
    expect(await load("cus_1")).toEqual({ paymentMethod: { ok: false }, invoices: { ok: false } });
    vi.doUnmock("@/lib/stripe");
  });
});
