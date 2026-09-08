"use client";

import { useState } from "react";
import posthog from "posthog-js";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  GitForkIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { EVENTS } from "@/lib/analytics";
import { servicesFor, skillDeepLink } from "@/lib/skill-links";
import type { ScheduleView } from "@/gateway/skills/schedules";
import { SERVICES } from "../connections/services";

/** The catalogue as the page passes it down: display fields plus the service
 * ids each skill needs, and which layer it is (SCRUM-226). No skill text
 * travels with the list; the editor loads a skill's file on demand and the
 * run message is composed server-side on the agent page from the slug. */
export type SkillListItem = {
  slug: string;
  title: string;
  situation: string;
  produces: string;
  services: string[];
  /** "published" (ours, seeded from the repo) or "yours" (the user's row). */
  layer: "published" | "yours";
  forkedFrom?: { slug: string; version: string } | null;
};

/** What the editor reads and writes: the user's skill with its file. */
type OwnSkill = {
  slug: string;
  title: string;
  situation: string;
  produces: string;
  tools: string[];
  accounts: "single" | "multiple";
  source: string;
};

function serviceName(id: string): string {
  return SERVICES.find((s) => s.id === id)?.name ?? id;
}

function toItem(skill: {
  slug: string;
  title: string;
  situation: string;
  produces: string;
  tools?: string[];
  services?: string[];
  layer: "published" | "yours";
  forkedFrom?: { slug: string; version: string } | null;
}): SkillListItem {
  return {
    slug: skill.slug,
    title: skill.title,
    situation: skill.situation,
    produces: skill.produces,
    services: skill.services ?? servicesFor({ tools: skill.tools ?? [] }),
    layer: skill.layer,
    forkedFrom: skill.forkedFrom ?? null,
  };
}

type ApiError = { error?: string; field?: string; message?: string; cap?: number; missing?: string[] };

function refusalText(status: number, body: ApiError): string {
  if (body.error === "invalid") return `${body.field ?? "input"}: ${body.message ?? "not valid"}`;
  if (body.error === "cap") return `You already have ${body.cap ?? 50} skills of your own, which is the limit. Delete one first.`;
  if (body.error === "not_connected") {
    return `Connect ${(body.missing ?? []).map(serviceName).join(" and ")} first.`;
  }
  if (body.error === "exists") return "You already have this.";
  if (status === 429) return "Too many requests. Try again in a moment.";
  return "That did not save. Try again.";
}

/* ---------------------------------------------------------------------- */
/* Schedules (SCRUM-225)                                                   */
/* ---------------------------------------------------------------------- */

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

/**
 * One card per skill, each with a Run link to the deep link (SCRUM-223); a
 * Schedules section and a Schedule control on runnable cards (SCRUM-225);
 * and the user's own skills beside the published ones (SCRUM-226): every
 * card says which layer it is, a published card offers Fork, the user's
 * cards offer Edit and Delete behind a confirmation, and New skill opens the
 * same editor empty. Every change goes through the API and the page
 * re-renders from the API's answer, never from an optimistic guess.
 *
 * A skill whose service is missing runs through the SAME link: the agent
 * page routes to connect and continues, so the intent is never dead-ended.
 * The button says "Connect and run" in that case rather than claiming one
 * click, which is the same action-plus-precondition rule the public CTA
 * follows.
 */
export function SkillsClient({
  connected,
  skills: initialSkills,
  schedules: initialSchedules = [],
}: {
  connected: string[];
  skills: SkillListItem[];
  schedules?: ScheduleView[];
}) {
  const have = new Set(connected);
  const [skills, setSkills] = useState<SkillListItem[]>(initialSkills);
  const [schedules, setSchedules] = useState<ScheduleView[]>(initialSchedules);
  const [creating, setCreating] = useState(false);
  const scheduled = new Set(schedules.map((s) => s.skillSlug));

  const replaceSkill = (item: SkillListItem) =>
    setSkills((list) => list.map((s) => (s.slug === item.slug ? item : s)));
  const replaceSchedule = (next: ScheduleView) =>
    setSchedules((list) => list.map((s) => (s.id === next.id ? next : s)));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Skills</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Routines the agent runs for you on the accounts you connect. Run one now, schedule it,
            fork a published one to make it yours, or write your own.
          </p>
        </div>
        {!creating && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            onClick={() => setCreating(true)}
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            New skill
          </button>
        )}
      </div>

      {creating && (
        <div className="mt-6">
          <SkillEditor
            initial={null}
            onCancel={() => setCreating(false)}
            onSaved={(saved) => {
              setSkills((list) => [...list.filter((s) => s.slug !== saved.slug), toItem(saved)]);
              posthog.capture(EVENTS.SKILL_CREATED, { skill: saved.slug, source: "dashboard" });
              setCreating(false);
            }}
          />
        </div>
      )}

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
                onChange={replaceSchedule}
                onDeleted={(id) => setSchedules((list) => list.filter((x) => x.id !== id))}
              />
            ))}
          </ul>
        </section>
      )}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2">
        {skills.map((skill) => (
          <SkillCardRow
            key={skill.slug}
            skill={skill}
            have={have}
            scheduled={scheduled.has(skill.slug)}
            onScheduled={(s) => setSchedules((list) => [...list, s])}
            onChange={replaceSkill}
            onRemoved={(slug, published) =>
              setSkills((list) =>
                published
                  ? list.map((s) => (s.slug === slug ? published : s))
                  : list.filter((s) => s.slug !== slug)
              )
            }
          />
        ))}
      </ul>
    </div>
  );
}

function SkillCardRow({
  skill,
  have,
  scheduled,
  onScheduled,
  onChange,
  onRemoved,
}: {
  skill: SkillListItem;
  have: Set<string>;
  scheduled: boolean;
  onScheduled: (s: ScheduleView) => void;
  onChange: (item: SkillListItem) => void;
  onRemoved: (slug: string, published: SkillListItem | null) => void;
}) {
  const [editing, setEditing] = useState<OwnSkill | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = skill.services.filter((id) => !have.has(id));
  const ready = missing.length === 0;
  const mine = skill.layer === "yours";

  const fork = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: skill.slug }),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError & { skill?: Parameters<typeof toItem>[0] };
      if (!res.ok || !body.skill) {
        setError(refusalText(res.status, body));
        return;
      }
      posthog.capture(EVENTS.SKILL_FORKED, { skill: skill.slug, source: "dashboard" });
      onChange(toItem(body.skill));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/own/${encodeURIComponent(skill.slug)}`);
      const body = (await res.json().catch(() => ({}))) as { skill?: OwnSkill };
      if (!res.ok || !body.skill) {
        setError("Could not load the skill for editing. Try again.");
        return;
      }
      setEditing(body.skill);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/own/${encodeURIComponent(skill.slug)}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { published?: SkillListItem | null };
      if (!res.ok) {
        setError("That did not delete. Try again.");
        return;
      }
      onRemoved(skill.slug, body.published ?? null);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (editing) {
    return (
      <li className="rounded-2xl border border-border bg-background p-5 sm:col-span-2">
        <SkillEditor
          initial={editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            onChange(toItem(saved));
            posthog.capture(EVENTS.SKILL_UPDATED, { skill: saved.slug, source: "dashboard" });
            setEditing(null);
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col rounded-2xl border border-border bg-background p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-base font-semibold leading-snug text-foreground">
          {skill.title}
        </h2>
        <span
          className={
            mine
              ? "shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          }
        >
          {mine ? "Your version" : "Published"}
        </span>
      </div>
      <p className="mt-2 text-sm italic leading-relaxed text-muted-foreground">
        &ldquo;{skill.situation}&rdquo;
      </p>
      <p className="mt-2 text-sm leading-relaxed text-foreground/90">{skill.produces}</p>

      <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
        {skill.services.map((id) => (
          <li className="flex items-center gap-1.5" key={id}>
            {have.has(id) ? (
              <CheckCircle2Icon aria-hidden="true" className="size-3.5 text-emerald-600" />
            ) : (
              <CircleDashedIcon aria-hidden="true" className="size-3.5" />
            )}
            {serviceName(id)} {have.has(id) ? "connected" : "not connected"}
          </li>
        ))}
      </ul>

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {!mine && (
            <a
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              href={`/skills/${skill.slug}`}
            >
              Read the skill
            </a>
          )}
          {mine ? (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
                disabled={busy}
                onClick={() => void startEdit()}
              >
                <PencilIcon aria-hidden="true" className="size-3" />
                Edit
              </button>
              {confirming ? (
                <span className="inline-flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {skill.forkedFrom
                      ? "Delete your version? Nothing else changes and the published skill comes back."
                      : "Delete this skill? Its versions are kept but it will not show or run."}
                  </span>
                  <button
                    type="button"
                    className="rounded-full bg-destructive px-3 py-1 font-medium text-destructive-foreground"
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
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  <Trash2Icon aria-hidden="true" className="size-3" />
                  Delete
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
              disabled={busy}
              onClick={() => void fork()}
            >
              <GitForkIcon aria-hidden="true" className="size-3" />
              Fork
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {ready && !scheduled && <ScheduleControl slug={skill.slug} onCreated={onScheduled} />}
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
                layer: skill.layer,
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
}

/** Cadence, hour and the browser's zone; the API answers with the schedule
 * or the true reason it refused (SCRUM-225). */
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

/* ---------------------------------------------------------------------- */
/* A user's own skill: the editor (SCRUM-226)                              */
/* ---------------------------------------------------------------------- */

const EMPTY: OwnSkill = {
  slug: "",
  title: "",
  situation: "",
  produces: "",
  tools: [],
  accounts: "single",
  source: "---\nname: my-skill\ndescription: What this skill does, in one line.\n---\n\n# My skill\n\n1. ...\n",
};

/** The editor for a user's skill: the fields and a plain textarea for the
 * file. Saves through POST (new) or PATCH (a new version of an existing
 * one); the API's refusal is shown as it came, naming the field. */
function SkillEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: OwnSkill | null;
  onCancel: () => void;
  onSaved: (skill: Parameters<typeof toItem>[0] & OwnSkill) => void;
}) {
  const [draft, setDraft] = useState<OwnSkill>(initial ?? EMPTY);
  const [toolsText, setToolsText] = useState((initial?.tools ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = initial === null;

  const save = async () => {
    setBusy(true);
    setError(null);
    const tools = toolsText
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const payload = {
      title: draft.title,
      situation: draft.situation,
      produces: draft.produces,
      tools,
      accounts: draft.accounts,
      source: draft.source,
    };
    try {
      const res = await fetch(isNew ? "/api/skills/own" : `/api/skills/own/${encodeURIComponent(draft.slug)}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as ApiError & { skill?: Parameters<typeof toItem>[0] & OwnSkill };
      if (!res.ok || !body.skill) {
        setError(refusalText(res.status, body));
        return;
      }
      onSaved(body.skill);
    } catch {
      setError("That did not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, name: keyof OwnSkill, multiline = false) => (
    <label className="block text-xs text-muted-foreground">
      {label}
      {multiline ? (
        <textarea
          name={name}
          className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          rows={name === "source" ? 14 : 2}
          value={draft[name] as string}
          onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
        />
      ) : (
        <input
          name={name}
          className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          value={draft[name] as string}
          onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
        />
      )}
    </label>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-background p-5">
      <h2 className="font-display text-base font-semibold text-foreground">
        {isNew ? "New skill" : `Edit your version: ${draft.title}`}
      </h2>
      {field("Title", "title")}
      {field("The situation it is for", "situation")}
      {field("What it produces", "produces", true)}
      <label className="block text-xs text-muted-foreground">
        Tools it uses, by name, comma separated
        <input
          name="tools"
          className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          value={toolsText}
          onChange={(e) => setToolsText(e.target.value)}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Accounts
        <select
          name="accounts"
          className="mt-1 block rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          value={draft.accounts}
          onChange={(e) => setDraft({ ...draft, accounts: e.target.value as OwnSkill["accounts"] })}
        >
          <option value="single">One account</option>
          <option value="multiple">Several accounts</option>
        </select>
      </label>
      {field("The skill file", "source", true)}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          disabled={busy}
          onClick={() => void save()}
        >
          Save
        </button>
        <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={onCancel}>
          Cancel
        </button>
        <span className="text-xs text-muted-foreground">Every save is a new version; the previous one is kept.</span>
      </div>
    </div>
  );
}
