import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { leads, TEAM_SIZE_VALUES } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { leadsMinuteLimiter, leadsHourLimiter } from "@/gateway/leads/limiter";
import { sendSlack } from "@/lib/slack";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  company: z.string().trim().min(1).max(100),
  teamSize: z.enum(TEAM_SIZE_VALUES).optional(),
  useCase: z.string().trim().max(2000).optional(),
  website: z.string().optional(), // honeypot
  utm: z
    .object({
      source: z.string().max(200).optional(),
      medium: z.string().max(200).optional(),
      campaign: z.string().max(200).optional(),
      term: z.string().max(200).optional(),
      content: z.string().max(200).optional(),
    })
    .optional(),
  referrer: z.string().max(2000).optional(),
});

function getClientIp(req: NextRequest): string {
  // Prod sits behind Cloudflare (origin :80 is firewalled to CF ranges), so
  // CF-Connecting-IP is the trustworthy client IP. The leftmost XFF entry is
  // client-controlled and only a dev/local fallback — never prefer it.
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

function hashIp(ip: string): string {
  const { LEADS_IP_SALT } = getEnv();
  return createHash("sha256").update(`${LEADS_IP_SALT}:${ip}`).digest("hex");
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const ipHash = hashIp(ip);

  const minute = leadsMinuteLimiter.check(ipHash);
  const hour = leadsHourLimiter.check(ipHash);
  if (!minute.ok || !hour.ok) {
    const retryAfterMs = Math.max(minute.retryAfterMs, hour.retryAfterMs);
    return NextResponse.json(
      { error: "rate_limit" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      }
    );
  }

  let parsed;
  try {
    const json = await req.json();
    parsed = bodySchema.safeParse(json);
  } catch {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }

  const data = parsed.data;

  // Honeypot tripped — silently accept without writing
  if (data.website && data.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const contactLine = `${data.name} <${data.email}> — ${data.company}`;

  try {
    await db.insert(leads).values({
      name: data.name,
      email: data.email,
      company: data.company,
      teamSize: data.teamSize,
      useCase: data.useCase,
      utmSource: data.utm?.source,
      utmMedium: data.utm?.medium,
      utmCampaign: data.utm?.campaign,
      utmTerm: data.utm?.term,
      utmContent: data.utm?.content,
      referrer: data.referrer,
      ipHash,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    const utmBits = [data.utm?.source, data.utm?.medium, data.utm?.campaign]
      .filter(Boolean)
      .join(" / ");
    void sendSlack("leads", {
      text:
        `🟢 New lead: ${contactLine}` +
        (data.teamSize ? ` · team ${data.teamSize}` : "") +
        (utmBits ? `\nUTM: ${utmBits}` : "") +
        (data.referrer ? `\nReferrer: ${data.referrer}` : "") +
        (data.useCase ? `\nUse case: ${data.useCase}` : ""),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[leads] insert failed", { message: (err as Error).message });
    void sendSlack("alerts", {
      text:
        `🔴 Lead insert FAILED — contact is recoverable from this message:\n` +
        `${contactLine}\n` +
        `Error: ${(err as Error).message}`,
    });
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
