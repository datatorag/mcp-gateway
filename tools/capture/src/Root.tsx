import { Composition, Still } from "remotion";
import "./style.css";
import "./lib/fonts";
import { FORMATS } from "./lib/formats";
import { ConnectorCardShot } from "./shots/connector-card";
import { DocsDemoShot } from "./shots/docs-demo";

/**
 * One <Still> per shot per format for images; a <Composition> reusing the
 * same shot component (with a real cue frame) for motion. Add new shots in
 * src/shots/ and register them here.
 */
/**
 * Docs stills: one per scripted session, each sized to ITS OWN transcript.
 * Height belongs to the script, not to the format, a shared height would
 * either clip the tall ones or leave dead space under the short ones, and
 * clipping is the failure that looks fine in a thumbnail. Re-measure a value
 * here whenever its script's copy changes.
 */
const DOCS_SHOTS: { id: string; height: number }[] = [
  { id: "format", height: 1754 },
  { id: "sheets", height: 1478 },
  { id: "slides", height: 1448 },
  { id: "gmail", height: 1050 },
  { id: "accounts", height: 2160 },
];

export function Root() {
  return (
    <>
      {DOCS_SHOTS.map(({ id, height }) => (
        <Still
          key={`docs-${id}`}
          id={`docs-${id}`}
          component={DocsDemoShot}
          width={FORMATS.docs.width}
          height={height}
          defaultProps={{ scriptId: id, format: "docs" as const }}
        />
      ))}
      {(Object.keys(FORMATS) as (keyof typeof FORMATS)[]).map((format) => (
        <Still
          key={`connector-card-${format}`}
          id={`connector-card-${format}`}
          component={ConnectorCardShot}
          width={FORMATS[format].width}
          height={FORMATS[format].height}
          defaultProps={{ format }}
        />
      ))}
      <Composition
        id="connector-card-video"
        component={ConnectorCardShot}
        width={FORMATS.landscape.width}
        height={FORMATS.landscape.height}
        fps={30}
        durationInFrames={90}
        defaultProps={{ format: "landscape" as const, cue: 15 }}
      />
    </>
  );
}
