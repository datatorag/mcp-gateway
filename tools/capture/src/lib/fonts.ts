/**
 * The product loads Inter, Montserrat, and PT Mono via next/font, which
 * injects the --font-inter / --font-montserrat / --font-pt-mono variables.
 * That machinery doesn't exist outside Next, so captures load the same faces
 * here (@remotion/google-fonts wraps the delayRender/continueRender dance —
 * top-level await is unavailable, the bundler targets chrome85) and
 * style.css binds the variables to these family names.
 */
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadPTMono } from "@remotion/google-fonts/PTMono";

loadInter();
loadMontserrat();
loadPTMono();
