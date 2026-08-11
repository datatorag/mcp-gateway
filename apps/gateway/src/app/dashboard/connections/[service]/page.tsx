import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { getService } from "../services";
import { ConnectionDetailClient } from "./client";

interface Props {
  params: Promise<{ service: string }>;
}

/** Same page-level session check as every other dashboard route that renders
 * something. `proxy.ts` gates `/dashboard/*` on the session cookie being
 * PRESENT rather than valid, so a made-up value walks past it.
 *
 * The check runs BEFORE the route parameter is read, so nothing
 * user-controlled is processed ahead of authentication. */
export default async function ConnectionDetailPage({ params }: Props) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  const { service: serviceId } = await params;
  const service = getService(serviceId);
  if (!service) notFound();

  return (
    <div>
      <Link
        href="/dashboard"
        className="text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        &larr; Dashboard
      </Link>

      <div className="mt-4 flex items-center gap-4">
        <div className="shrink-0">{service.icon}</div>
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {service.name}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {service.description}
          </p>
        </div>
      </div>

      <ConnectionDetailClient service={serviceId} connectUrl={service.connectUrl} />
    </div>
  );
}
