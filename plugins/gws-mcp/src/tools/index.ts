import type { GwsClient } from "../gws-client.js";
import type { ToolDef } from "./annotations.js";
import { authTools, handleAuth } from "./auth.js";
import { genericTools, handleGeneric } from "./generic.js";
import { gmailTools, handleGmail } from "./gmail.js";
import { driveTools, handleDrive } from "./drive.js";
import { calendarTools, handleCalendar } from "./calendar.js";
import { contactsTools, handleContacts } from "./contacts.js";
import { sheetsTools, handleSheets } from "./sheets.js";
import { sheetsRowTools, handleSheetsRows } from "./sheets-rows.js";
import { sheetsFormatTools, handleSheetsFormat } from "./sheets-format.js";
import { sheetsQueryTools, handleSheetsQuery } from "./sheets-query.js";
import { docsTools, handleDocs } from "./docs.js";
import { slidesTools, handleSlides } from "./slides.js";
import { tasksTools, handleTasks } from "./tasks.js";

export type ToolHandler = (
  client: GwsClient,
  name: string,
  args: Record<string, unknown>
) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;

// One entry per module: the tool list and the dispatch map both derive from
// it, so a new module is a one-line addition rather than a two-list edit.
const modules: [ToolDef[], ToolHandler][] = [
  [authTools, handleAuth],
  [gmailTools, handleGmail],
  [calendarTools, handleCalendar],
  [contactsTools, handleContacts],
  [driveTools, handleDrive],
  [sheetsTools, handleSheets],
  [sheetsRowTools, handleSheetsRows],
  [sheetsFormatTools, handleSheetsFormat],
  [sheetsQueryTools, handleSheetsQuery],
  [docsTools, handleDocs],
  [slidesTools, handleSlides],
  [tasksTools, handleTasks],
  [genericTools, handleGeneric],
];

export const allTools = modules.flatMap(([tools]) => tools);

export const toolHandlers = new Map<string, ToolHandler>(
  modules.flatMap(([tools, handler]) =>
    tools.map((t) => [t.name, handler] as [string, ToolHandler])
  )
);
