import { AbsoluteFill, Img, staticFile } from "remotion";

/**
 * The site-wide link-preview card (SCRUM-367): the logo and the name on the
 * marketing hero's navy, the same lockup the navbar carries, and nothing
 * else. No claim goes on it: a card is cached by every chat app that ever
 * unfurled a link, so anything it says outlives the day it was true.
 *
 * Crawlers crop to different shapes, so the lockup sits in the centre with
 * wide margins on every side. Rendered to apps/gateway/public as
 * social-card.png (`remotion still social-card`). Chat apps cache a card by
 * its URL, so a redrawn card goes out under a new filename.
 */
export const SOCIAL_CARD = { width: 1200, height: 630 } as const;

export function SocialCardShot() {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a1628",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        <Img src={staticFile("datatorag-logo.png")} width={168} height={168} />
        <span
          style={{
            fontFamily: "var(--font-montserrat)",
            fontWeight: 700,
            fontSize: 104,
            letterSpacing: "-0.025em",
            color: "#FFFFFF",
            lineHeight: 1,
          }}
        >
          DataToRAG
        </span>
      </div>
    </AbsoluteFill>
  );
}
