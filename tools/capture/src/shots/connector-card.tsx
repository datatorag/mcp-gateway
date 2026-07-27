import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ServiceIcon } from "@/components/service-icon";
import { AUTHOR_WIDTH, FORMATS, type CaptureFormat } from "../lib/formats";
import { SETTLED, cueProgress, enterStyle } from "../lib/cue";

/**
 * Reference shot: the Google Workspace connector card, built from the REAL
 * gateway components (Card, Badge, ServiceIcon) — imported, not copied. If
 * the product's card changes, the next render changes with it.
 *
 * `cue` defaults to SETTLED so the same component renders as a still; the
 * video composition passes a real frame to get the entrance animation.
 */
export function ConnectorCardShot({
  format,
  cue = SETTLED,
}: {
  format: CaptureFormat;
  cue?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spec = FORMATS[format];
  const p = cueProgress({ frame, fps, cue });

  const lines: { text: string; services: string[] }[] = [
    { text: "Search emails, send replies, create and update drafts", services: ["gmail"] },
    { text: "Read and create Docs, Sheets, and Slides", services: ["docs", "sheets", "slides"] },
    { text: "Search Drive, manage files and folders", services: ["drive"] },
    { text: "Manage Calendar events, Contacts, and Tasks", services: ["calendar", "contacts", "tasks"] },
  ];

  return (
    // AbsoluteFill is fine as the stage background. It is NOT fine for
    // positioned boxes: it hard-sets width/height to 100%, so right/bottom
    // inset props silently do nothing. Position content with plain divs.
    <AbsoluteFill className="bg-background">
      <div
        style={{
          position: "absolute",
          left: spec.pad,
          top: spec.pad,
          // CSS zoom, not transform:scale — zoom participates in layout, so
          // this container sizes itself to the zoomed content.
          zoom: spec.zoom,
          width: AUTHOR_WIDTH,
          ...enterStyle(p),
        }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold">
                  Google Workspace
                </CardTitle>
                <CardDescription className="text-xs">
                  Gmail, Drive, Calendar, Docs, Sheets, Slides, Contacts, and
                  Tasks
                </CardDescription>
              </div>
              <Badge variant="success">
                <span className="size-1.5 rounded-full bg-current" />
                Connected
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {lines.map((cap) => (
                <li
                  key={cap.text}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <span className="flex shrink-0 items-center gap-1 pt-px">
                    {cap.services.map((s) => (
                      <ServiceIcon key={s} service={s} size={14} />
                    ))}
                  </span>
                  {cap.text}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AbsoluteFill>
  );
}
