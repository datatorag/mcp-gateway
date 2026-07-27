import { Composition, Still } from "remotion";
import "./style.css";
import "./lib/fonts";
import { FORMATS } from "./lib/formats";
import { ConnectorCardShot } from "./shots/connector-card";

/**
 * One <Still> per shot per format for images; a <Composition> reusing the
 * same shot component (with a real cue frame) for motion. Add new shots in
 * src/shots/ and register them here.
 */
export function Root() {
  return (
    <>
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
