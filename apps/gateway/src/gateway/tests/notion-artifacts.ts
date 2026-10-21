import type { CaseContext } from "./types";
import { SUBJECT_PREFIX } from "./send-guard";
import { sameNotionId } from "./notion-shape";

/**
 * What the Notion write cases share (SCRUM-366, stage 2): the label every
 * created object carries and the checks on what comes back.
 *
 * Every write case is a RESTORING PAIR on something the run made and
 * labelled. The send guard lets a write reach only the fixtures and what
 * this run created, and requires the smoke prefix and the run stamp in the
 * title of everything created, so whatever a failed cleanup leaves is found
 * by searching for the stamp.
 *
 * Nothing here calls a tool. The calls stay in the case files, where the
 * declare-versus-call, argument and role checks read them; a helper that
 * called tools would be a way round all three.
 *
 * A page is taken away by moving it to the trash, the only delete Notion's
 * API has, and the trash is PROVEN BY READING THE PAGE BACK with `in_trash`
 * true, never by a read failing: a page in Notion's trash still reads by id.
 */

export type NotionPage = {
  id?: string;
  title?: string;
  in_trash?: boolean;
  parent?: { type?: string; id?: string } | null;
  markdown?: string;
  properties?: Record<string, unknown>;
};

export type NotionDatabase = {
  id?: string;
  title?: string;
  data_sources?: { id?: string; name?: string; properties?: { name?: string; type?: string }[] }[];
};

/** The title of something a case creates: the smoke prefix, what it is, and
 * the case's stamp, which carries the run's. */
export function notionLabel(ctx: CaseContext, what: string): string {
  return `${SUBJECT_PREFIX} ${what} ${ctx.stamp}`;
}

/** The id a create answered with, or a throw saying what cannot follow. */
export function createdId(what: string, answer: { id?: unknown }): string {
  if (typeof answer.id !== "string" || answer.id === "") {
    throw new Error(`the create answered without an id, so the ${what} cannot be read or taken away`);
  }
  return answer.id;
}

/** A trash Notion accepted, then the page read back: both say in_trash. */
export function assertTrashed(what: string, answer: NotionPage, readBack: NotionPage): void {
  if (answer.in_trash !== true) throw new Error(`notion_update_page answered in_trash ${String(answer.in_trash)} for the ${what}`);
  if (readBack.in_trash !== true) {
    throw new Error(`the ${what} does not read back as in the trash after a trash Notion accepted`);
  }
}

/** The page sits under `parentId`, read back from the page itself. */
export function assertParent(what: string, page: NotionPage, parentId: string): void {
  if (page.parent?.type !== "page" || !sameNotionId(page.parent.id, parentId)) {
    throw new Error(`the ${what} does not read back under the page it was put under`);
  }
}

/** The property names of one data source in a `notion_get_database` read. */
export function schemaNames(db: NotionDatabase, dataSourceId: string): string[] {
  const source = (db.data_sources ?? []).find((d) => sameNotionId(d.id, dataSourceId));
  if (!source) throw new Error("notion_get_database does not list the data source the database was created with");
  return (source.properties ?? []).map((p) => String(p.name));
}

/** The one data source a database was created with. */
export function onlyDataSource(db: NotionDatabase): string {
  const sources = db.data_sources ?? [];
  if (sources.length !== 1 || typeof sources[0].id !== "string") {
    throw new Error(`notion_create_database answered ${sources.length} data sources, not the one it creates`);
  }
  return sources[0].id;
}

/** Markdown compared the way Notion re-renders it: trailing space on a line
 * and blank lines at either end are not content. */
export function sameMarkdown(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (typeof v === "string" ? v.replace(/[ \t]+$/gm, "").trim() : null);
  return norm(a) !== null && norm(a) === norm(b);
}

/** A child page or database in a page's markdown. A copy re-creates the
 * markdown, and writing a reference to a child back is not something a test
 * run should find out about on the fixture. */
export function hasChildObject(markdown: unknown): boolean {
  return typeof markdown === "string" && /<(page|database)\b/i.test(markdown);
}
