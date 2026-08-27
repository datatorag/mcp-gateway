import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { MessageRow } from "@/app/dashboard/playground-presentation";
import {
  buildMessages,
  finishedState,
} from "@/components/demo/use-script-player";
import { DEMO_SCRIPTS, type DemoScript } from "@/components/demo/demo-scripts";
import { formatScript } from "../lib/docs-scripts";
import { FORMATS, type CaptureFormat } from "../lib/formats";
import { SETTLED, cueProgress, enterStyle } from "../lib/cue";

/**
 * Docs imagery: one scripted playground session, rendered at its RESOLVED end
 * state, inside the same window chrome the landing page uses.
 *
 * WHY THE END STATE AND NOT A MID-CONVERSATION FRAME: the product already
 * renders exactly this state, `prefers-reduced-motion` on the landing page
 * shows the finished transcript with no playback at all. Capturing it means
 * the image is a state real visitors see, rather than a screenshot-only path
 * that can drift from the product without anyone noticing.
 *
 * Everything on screen is imported: MessageRow is the playground's real
 * transcript row, buildMessages/finishedState are the real player's own
 * projection, and the scripts are the real authored data. Nothing here is a
 * copy, so nothing here can silently disagree with the product.
 */

const EMPTY: Record<string, never> = {};

/** Which tool card each docs shot expands: the one its page documents.
 * Absent means expand everything, which is right for the short scripts whose
 * only call IS the subject. */
const EXPAND: Record<string, readonly string[]> = {
  // The write is the subject; the lookup that found the file is not.
  format: ["sheets_format_table"],
  sheets: ["sheets_update"],
  slides: ["slides_batch_update"],
  gmail: ["gmail_send"],
  // Two searches against two different accounts IS the point of this one,
  // so both expand: the `account` argument is the thing being documented.
  accounts: ["gmail_search"],
};
const noop = () => {};

/** Scripts available to shots: the four the landing page ships, plus the
 * docs-only formatting one. Keyed by id so Root can register by name. */
export const DOCS_SCRIPTS: Record<string, DemoScript> = Object.fromEntries(
  [...DEMO_SCRIPTS, formatScript].map((s) => [s.id, s])
);

/** Header label per script. The landing page's own labels, plus the new one.
 * Kept here rather than imported from demo-layout because that module also
 * carries measured frame heights for the bento's width tiers, which have
 * nothing to do with a still. */
const SERVICE_LABEL: Record<string, string> = {
  sheets: "Sheets",
  slides: "Slides",
  gmail: "Gmail",
  accounts: "Gmail · two accounts",
  format: "Sheets · formatting",
};

export function DocsDemoShot({
  scriptId,
  format,
  cue = SETTLED,
}: {
  scriptId: string;
  format: CaptureFormat;
  cue?: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spec = FORMATS[format];
  const p = cueProgress({ frame, fps, cue });

  const script = DOCS_SCRIPTS[scriptId];
  if (!script) {
    throw new Error(
      `DocsDemoShot: no script "${scriptId}". Known: ${Object.keys(
        DOCS_SCRIPTS
      ).join(", ")}`
    );
  }

  // The player's own terminal projection, not a hand-built message list.
  const messages = buildMessages(script, finishedState(script));

  return (
    <AbsoluteFill className="bg-background">
      {/* Offset by `pad`, NOT centred. CSS `zoom` multiplies the used value
          of `left`, so `left: 50%` resolves against the unzoomed parent and
          `translateX(-50%)` shifts by the unzoomed width, the content lands
          half a canvas to the right and clips. The canvas is instead sized to
          fit exactly (see DOCS_CANVAS_WIDTH in formats.ts), which is also how
          the reference shot does it. AbsoluteFill hard-sets width/height to
          100%, so the positioned box is a plain div, per the harness rule. */}
      <div
        style={{
          position: "absolute",
          top: spec.pad,
          left: spec.pad,
          // CSS zoom, not transform: scale, zoom participates in layout.
          zoom: spec.zoom,
          width: spec.authorWidth,
          ...enterStyle(p),
        }}
      >
        {/* The landing page's window chrome, restated in the shot because
            DemoWindow is a client component that lazy-loads its own playback
            chunk via next/dynamic, which does not exist outside Next. The
            CHROME is four utility classes; the TRANSCRIPT, which is the part
            that could misrepresent the product, is the real component. */}
        <div className="capture-wrap-code overflow-hidden rounded-xl border border-border bg-background text-left shadow-lg">
          <div className="border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-foreground/80">
            {SERVICE_LABEL[scriptId] ?? scriptId}
          </div>
          <div className="p-4">
            {messages.map((message, index) => (
              <MessageRow
                awaitingConfirm={false}
                busy={false}
                comments={EMPTY}
                // Only the call the page is ABOUT expands. Expanding every
                // card buries it: a setup call like drive_search returns a
                // long file blob that is three times the height of the call
                // being documented and says nothing the prose does not.
                expandTools={EXPAND[scriptId] ?? true}
                feedback={EMPTY}
                isLast={index === messages.length - 1}
                key={message.id}
                message={message}
                onCommentChange={noop}
                onDecide={noop}
                onRate={noop}
                onRegenerate={noop}
                onSendComment={noop}
                showActions={false}
              />
            ))}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
