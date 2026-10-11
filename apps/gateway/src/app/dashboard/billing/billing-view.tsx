import { Card } from "@/components/ui/card";
import { PlanCards } from "@/components/plan-cards";
import { PortalAction } from "@/components/portal-action";
import type { BillingUsage } from "@/gateway/usage/period";
import type { BillingDetails, InvoiceSummary } from "@/lib/billing-details";
import {
  ALL_INVOICES_LABEL,
  BILLING_SUBTITLE,
  CALLS_LABEL,
  FREE_AT_CAP,
  INVOICES_TITLE,
  INVOICES_UNAVAILABLE,
  NOT_CAPPED,
  NO_INVOICES,
  PAYMENT_TITLE,
  PAYMENT_UNAVAILABLE,
  PRO_OVER_ALLOWANCE,
  RUNS_LABEL,
  UPDATE_LABEL,
  USAGE_TITLE,
  cardLine,
  expiryLine,
  resetLine,
} from "./billing-copy";

/**
 * The Billing page body (SCRUM-352). Everything arrives from the server
 * component, so the page is right on first paint; the only client islands are
 * the checkout and portal buttons.
 *
 * WHAT RENDERS WITHOUT A STRIPE CUSTOMER: the plan cards and the usage, and
 * nothing else. No payment or invoice section, not even an empty one: a Free
 * user has no billing relationship, and an empty card would say otherwise.
 */

const count = (n: number) => n.toLocaleString("en-US");

function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap && cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div data-meter={label}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground">{label}</span>
        <span className="text-muted-foreground" data-meter-value>
          {cap === null ? `${count(used)} used, ${NOT_CAPPED}` : `${count(used)} of ${count(cap)}`}
        </span>
      </div>
      {cap !== null && (
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={cap}
          aria-valuenow={Math.min(used, cap)}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function UsageSection({ usage }: { usage: BillingUsage }) {
  const atCap = usage.hardCap && usage.callsIncluded !== null && usage.calls >= usage.callsIncluded;
  const over = !usage.hardCap && usage.callsIncluded !== null && usage.calls > usage.callsIncluded;
  return (
    <Card className="mt-8 p-5" data-section="usage">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold text-foreground">{USAGE_TITLE}</h2>
        <p className="text-xs text-muted-foreground">{resetLine(usage.resetsAt)}</p>
      </div>
      <div className="mt-4 space-y-4">
        <Meter label={CALLS_LABEL} used={usage.calls} cap={usage.callsIncluded} />
        <Meter label={RUNS_LABEL} used={usage.agentRuns} cap={usage.agentRunCap} />
      </div>
      {atCap && <p className="mt-4 text-sm text-foreground">{FREE_AT_CAP}</p>}
      {over && <p className="mt-4 text-sm text-muted-foreground">{PRO_OVER_ALLOWANCE}</p>}
    </Card>
  );
}

const linkButton =
  "rounded-[var(--radius)] border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-all hover:border-primary/40 hover:bg-secondary/50";

function PaymentSection({ details }: { details: BillingDetails["paymentMethod"] }) {
  // No method on file: nothing to show, so no card at all.
  if (details.ok && details.value === null) return null;
  return (
    <Card className="mt-6 p-5" data-section="payment">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-foreground">{PAYMENT_TITLE}</h2>
        <PortalAction label={UPDATE_LABEL} source="billing_payment_update" className={linkButton} />
      </div>
      {details.ok && details.value ? (
        details.value.type === "card" && details.value.last4 ? (
          <div className="mt-3 text-sm">
            <p className="text-foreground">{cardLine(details.value.brand ?? "card", details.value.last4)}</p>
            {details.value.expMonth && details.value.expYear && (
              <p className="mt-0.5 text-muted-foreground">{expiryLine(details.value.expMonth, details.value.expYear)}</p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-foreground">{details.value.type.replace(/_/g, " ")}</p>
        )
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{PAYMENT_UNAVAILABLE}</p>
      )}
    </Card>
  );
}

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function InvoiceRow({ invoice }: { invoice: InvoiceSummary }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm" data-invoice={invoice.id}>
      <span className="text-foreground">
        {invoice.created.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
      </span>
      <span className="flex items-center gap-3">
        <span className="text-foreground">{money(invoice.amount, invoice.currency)}</span>
        {invoice.status && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground">
            {invoice.status}
          </span>
        )}
        {invoice.pdfUrl && (
          // ph-no-capture: a Stripe invoice link opens without signing in,
          // and recordings copy link addresses as they are (SCRUM-414).
          <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer" className="ph-no-capture text-primary hover:underline">
            PDF
          </a>
        )}
      </span>
    </li>
  );
}

function InvoicesSection({ details }: { details: BillingDetails["invoices"] }) {
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-base font-bold text-foreground">{INVOICES_TITLE}</h2>
      <PortalAction label={ALL_INVOICES_LABEL} source="billing_all_invoices" className={linkButton} />
    </div>
  );
  if (details.ok && details.value.length === 0) {
    // Zero invoices: one quiet line, no card chrome.
    return (
      <div className="mt-6" data-section="invoices">
        <p className="text-sm text-muted-foreground">{NO_INVOICES}</p>
      </div>
    );
  }
  return (
    <Card className="mt-6 p-5" data-section="invoices">
      {header}
      {details.ok ? (
        <ul className="mt-2 divide-y divide-border">
          {details.value.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{INVOICES_UNAVAILABLE}</p>
      )}
    </Card>
  );
}

export function BillingView({
  plan,
  hasBillingAccount,
  usage,
  details,
}: {
  plan: string;
  hasBillingAccount: boolean;
  usage: BillingUsage | null;
  /** Read only when there is a Stripe customer; absent otherwise. */
  details?: BillingDetails;
}) {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">Billing</h1>
      <p className="mt-1 text-sm text-muted-foreground">{BILLING_SUBTITLE}</p>

      <PlanCards current={{ plan, hasBillingAccount }} className="mt-6 grid gap-6 lg:grid-cols-3" />

      {usage && <UsageSection usage={usage} />}

      {hasBillingAccount && details && (
        <>
          <PaymentSection details={details.paymentMethod} />
          <InvoicesSection details={details.invoices} />
        </>
      )}
    </div>
  );
}
