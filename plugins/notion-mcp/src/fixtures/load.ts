/* Test support, excluded from the build (tsconfig.json). */
import { readFileSync } from "node:fs";

/** One recorded Notion exchange, scrubbed: {status, request, body}. The
 * .json files beside this one were recorded against a test workspace on
 * 2026-10-21 (SCRUM-366 stage 0); person names, emails, avatar and file URLs
 * and the workspace name were replaced before they were copied here. */
export interface Recorded {
  status: number;
  request: { method: string; path: string; body?: unknown };
  body: any;
}

export function recorded(name: string): Recorded {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8")) as Recorded;
}
