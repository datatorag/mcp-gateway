"use client";

import { useState } from "react";
import posthog from "posthog-js";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  PauseIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { skillDeepLink } from "@/lib/skill-links";
import type { ScheduleView } from "@/gateway/skills/schedules";
import { SERVICES } from "../connections/services";

/** The catalogue as the page passes it down: display fields plus the service
 * ids each skill needs. No skill text travels to the client; the run message
 * is composed server-side on the agent page from the slug. */
export type SkillListItem = {
  slug: string;
  title: string;
  situation: string;
  produces: string;
  services: string[];
};

function serviceName(id: string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function cadenceLabel(s: Pick<ScheduleView, "cadence" | "weekday">): string {
  if (s.cadence === "daily") return "Every day";
  if (s.cadence === "weekdays") return "Weekdays";
  return `Every ${WEEKDAY_NAMES[s.weekday ?? 1]}`;
}

function timeLabel(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function whenLabel(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const PAUSE_LABELS: Record<NonNullable<ScheduleView["pausedReason"]>, string> = {
  user: "Paused by you",
  allowance: "Paused: run allowance reached",
  reconnect: "Paused: reconnect needed",
  failures: "Paused: three runs in a row failed",
};

function stateLabel(s: ScheduleView): string {
  if (!s.paused) return "Active";
  return s.pausedReason ? PAUSE_LABELS[s.pausedReason] : "Paused";
}

const DELIVERED_LABELS: Record<string, string> = {
  skill_email: "the skill emailed you",
  notification_email: "emailed you a summary",
  thread_only: "thread only",
};

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

type ApiError = { error?: string; missing?: string[] };

function refusalText(status: number, body: ApiError): string {
  if (body.error === "not_connected") {
    return `Connect ${(body.missing ?? []).map(serviceName).join(" and ")} first.`;
  }
  if (body.error === "exists") return "This skill already has a schedule.";
  if (status === 429) return "Too many requests. Try again in a moment.";
  return "That did not save. Try again.";
}

/**
 * One card per skill, each with a Run link to the deep link (SCRUM-223), a
 * Schedule control on the runnable ones (SCRUM-225), and a Schedules section
 * above the catalogue listing each schedule with its state and history.
 *
 * A skill whose service is missing runs through the SAME link: the agent
 * page routes to connect and continues, so the intent is never dead-ended.
 * The button says "Connect and run" in that case rather than claiming one
 * click, which is the same action-plus-precondition rule the public CTA
 * follows. Every schedule change goes through the API and the section
 * re-renders from the API's answer, never from an optimistic guess.
 */
export function SkillsClient({
  connected,
  skills,
  schedules: initialSchedules = [],
}: {
  connected: string[];
  skills: SkillListItem[];
  schedules?: ScheduleView[];
}) {
  const have = new Set(connected);
  const [schedules, setSchedules] = useState<ScheduleView[]>(initialSchedules);
  const scheduled = new Set(schedules.map((s) => s.skillSlug));

  const replace = (next: ScheduleView) =>
    setSchedules((list) => list.map((s) => (s.id === next.id ? next : s)));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="font-display text-2xl font-bold text-foreground">Skills</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Routines the agent runs for you on the accounts you connect. Run one now, schedule it,
        or read it first on the public page.
      </p>

      {schedules.length > 0 && (
        <section className="mt-6" aria-labelledby="schedules-heading">
          <h2 id="schedules-heading" className="font-display text-lg font-semibold text-foreground">
            Schedules
          </h2>
          <ul className="mt-3 space-y-3">
            {schedules.map((s) => (
              <ScheduleRow
                key={s.id}
                schedule={s}
                onChange={replace}
                onDeleted={(id) => setSchedules((list) => list.filter((x) => x.id !== id))}
              />
            ))}
          </ul>
        </section>
      )}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {skills.map((skill) => {
          const missing = skill.services.filter((id) => !have.has(id));
          const ready = missing.length === 0;
          return (
            <li
              className="flex flex-col rounded-2xl border border-border bg-background p-5"
              key={skill.slug}
            >
              <h2 className="font-display text-base font-semibold leading-snug text-foreground">
                {skill.title}
              </h2>
              <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">
                &ldquo;{skill.situation}&rdquo;
              </p>
              <p className="mt-2 text-sm leading-relaxed text-foreground/90">{skill.produces}</p>

              <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
                {skill.services.map((id) => (
                  <li className="flex items-center gap-1.5" key={id}>
                    {have.has(id) ? (
                      <CheckCircle2Icon
                        aria-hidden="true"
                        className="size-3.5 text-emerald-600"
                      />
                    ) : (
                      <CircleDashedIcon aria-hidden="true" className="size-3.5" />
                    )}
                    {serviceName(id)} {have.has(id) ? "connected" : "not connected"}
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center justify-between gap-3">
                <a
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                  href={`/skills/${skill.slug}`}
                >
                  Read the skill
                </a>
                <div className="flex items-center gap-2">
                  {ready && !scheduled.has(skill.slug) && (
                    <ScheduleControl
                      slug={skill.slug}
                      onCreated={(s) => setSchedules((list) => [...list, s])}
                    />
                  )}
                  {/* A plain anchor: the destination is a full page load of the
                      agent with the skill loaded, and the click event must fire
                      before navigation rather than be lost to a client route. */}
                  <a
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    href={skillDeepLink(skill.slug)}
                    onClick={() =>
                      posthog.capture(EVENTS.SKILL_RUN_CLICKED, {
                        skill: skill.slug,
                        source: "dashboard",
                        trigger: "manual",
                      })
                    }
                  >
                    <PlayIcon aria-hidden="true" className="size-3.5 fill-current" />
                    {ready ? "Run" : "Connect and run"}
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Cadence, hour and the browser's zone; the API answers with the schedule
 * or the true reason it refused. */
function ScheduleControl({
  slug,
  onCreated,
}: {
  slug: string;
  onCreated: (s: ScheduleView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cadence, setCadence] = useState<ScheduleView["cadence"]>("daily");
  const [weekday, setWeekday] = useState(1);
  const [hour, setHour] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        onClick={() => setOpen(true)}
      >
        <CalendarClockIcon aria-hidden="true" className="size-3.5" />
        Schedule
      </button>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    const timezone = browserTimezone();
    try {
      const res = await fetch("/api/skills/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          cadence,
          hour,
          minute: 0,
          ...(cadence === "weekly" ? { weekday } : {}),
          timezone,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError & { schedule?: ScheduleView };
      if (!res.ok || !body.schedule) {
        setError(refusalText(res.status, body));
        return;
      }
      posthog.capture(EVENTS.SKILL_SCHEDULED, { skill: slug, cadence, hour, source: "dashboard" });
      onCreated(body.schedule);
      setOpen(false);
    } catch {
      setError("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Cadence"
          className="rounded-md border border-border bg-background px-2 py-1"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as ScheduleView["cadence"])}
        >
          <option value="daily">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Weekly</option>
        </select>
        {cadence === "weekly" && (
          <select
            aria-label="Weekday"
            className="rounded-md border border-border bg-background px-2 py-1"
            value={weekday}
            onChange={(e) => setWeekday(Number(e.target.value))}
          >
            {WEEKDAY_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Hour"
          className="rounded-md border border-border bg-background px-2 py-1"
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {timeLabel(h, 0)}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">{browserTimezone()}</span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
          disabled={busy}
          onClick={() => void save()}
        >
          Save schedule
        </button>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ScheduleRow({
  schedule,
  onChange,
  onDeleted,
}: {
  schedule: ScheduleView;
  onChange: (s: ScheduleView) => void;
  onDeleted: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (paused: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      const body = (await res.json().catch(() => ({}))) as { schedule?: ScheduleView };
      if (!res.ok || !body.schedule) {
        setError("That did not save. Try again.");
        return;
      }
      onChange(body.schedule);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/schedules/${schedule.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("That did not delete. Try again.");
        return;
      }
      onDeleted(schedule.id);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-foreground">{schedule.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {cadenceLabel(schedule)} at {timeLabel(schedule.hour, schedule.minute)} ({schedule.timezone})
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className={schedule.paused ? "text-amber-700" : "text-emerald-700"}>{stateLabel(schedule)}</span>
            {!schedule.paused && <> &middot; next run {whenLabel(schedule.nextRunAt)}</>}
            {schedule.lastRunAt && <> &middot; last run {whenLabel(schedule.lastRunAt)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {schedule.paused ? (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
              disabled={busy}
              onClick={() => void patch(false)}
            >
              <PlayIcon aria-hidden="true" className="size-3" />
              Resume
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
              disabled={busy}
              onClick={() => void patch(true)}
            >
              <PauseIcon aria-hidden="true" className="size-3" />
              Pause
            </button>
          )}
          {confirming ? (
            <span className="inline-flex items-center gap-2 text-xs">
              <button
                type="button"
                className="rounded-full bg-destructive px-3 py-1.5 font-medium text-destructive-foreground"
                disabled={busy}
                onClick={() => void remove()}
              >
                Yes, delete
              </button>
              <button type="button" className="underline-offset-4 hover:underline" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2Icon aria-hidden="true" className="size-3" />
              Delete
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      {schedule.runs.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border text-xs">
          {schedule.runs.map((run) => (
            <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                {whenLabel(run.startedAt)} &middot; <span className="font-medium">{run.status}</span>
                {run.delivered && <> &middot; {DELIVERED_LABELS[run.delivered] ?? run.delivered}</>}
                {run.error && <> &middot; {run.error}</>}
              </span>
              {run.threadId && (
                <a className="underline-offset-4 hover:underline" href={`/dashboard/agent?thread=${run.threadId}`}>
                  Open the thread
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
