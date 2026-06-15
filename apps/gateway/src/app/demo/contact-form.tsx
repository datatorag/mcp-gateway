"use client";

import { useState } from "react";
import { TEAM_SIZE_VALUES, type TeamSize } from "@datatorag-mcp/db/schema";
import { reportLeadConversion } from "@/components/google-ads";

interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

interface Props {
  utm: Utm;
}

type Status = "idle" | "submitting" | "success" | "error";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function ContactForm({ utm }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [teamSize, setTeamSize] = useState<TeamSize | "">("");
  const [useCase, setUseCase] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          company,
          teamSize: teamSize || undefined,
          useCase: useCase || undefined,
          website,
          utm,
          referrer: typeof document !== "undefined" ? document.referrer : undefined,
        }),
      });

      if (res.ok) {
        reportLeadConversion();
        setStatus("success");
        return;
      }

      if (res.status === 429) {
        setErrorMsg("Too many requests. Try again in a minute.");
      } else if (res.status === 400) {
        setErrorMsg("Please check the form fields and try again.");
      } else {
        setErrorMsg("Something went wrong. Please try again or email support@datatorag.com.");
      }
      setStatus("error");
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-2xl border border-border bg-secondary/30 p-8">
        <h2 className="font-display text-xl font-semibold text-foreground">Thanks. We&apos;ll be in touch soon.</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          One of us will reach out within a business day to learn more about
          what you&apos;re working on. If you&apos;d rather email,{" "}
          <a href="mailto:support@datatorag.com" className="underline hover:text-foreground">
            support@datatorag.com
          </a>{" "}
          gets to the team directly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-border bg-background p-6">
      <div>
        <label htmlFor="name" className="text-sm font-medium text-foreground">
          Name
        </label>
        <input
          id="name"
          type="text"
          required
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`mt-1.5 ${inputClass}`}
          autoComplete="name"
        />
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-medium text-foreground">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={`mt-1.5 ${inputClass}`}
          autoComplete="email"
        />
      </div>

      <div>
        <label htmlFor="company" className="text-sm font-medium text-foreground">
          Company
        </label>
        <input
          id="company"
          type="text"
          required
          maxLength={100}
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className={`mt-1.5 ${inputClass}`}
          autoComplete="organization"
        />
      </div>

      <div>
        <label htmlFor="teamSize" className="text-sm font-medium text-foreground">
          Team size <span className="text-muted-foreground">(optional)</span>
        </label>
        <select
          id="teamSize"
          value={teamSize}
          onChange={(e) => setTeamSize(e.target.value as TeamSize | "")}
          className={`mt-1.5 ${inputClass}`}
        >
          <option value="">Select…</option>
          {TEAM_SIZE_VALUES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="useCase" className="text-sm font-medium text-foreground">
          What are you trying to do? <span className="text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="useCase"
          rows={4}
          maxLength={2000}
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          className={`mt-1.5 ${inputClass}`}
          placeholder="e.g., Our SDRs are drowning in inbox triage and we want AI to draft replies against our CRM..."
        />
      </div>

      {/* Honeypot — hidden from humans, attractive to bots */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {errorMsg && (
        <p className="text-sm text-red-600" role="alert">
          {errorMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full rounded-[var(--radius)] bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
      >
        {status === "submitting" ? "Sending…" : "Get in touch"}
      </button>

      <p className="text-xs text-muted-foreground">
        By submitting, you agree to be contacted about DataToRAG. We never share
        your info. See our{" "}
        <a href="/privacy" className="underline hover:text-foreground">
          privacy policy
        </a>
        .
      </p>
    </form>
  );
}
