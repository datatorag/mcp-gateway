import { marked } from "marked";
import { defineCollection, field, type ParsedFile } from "./content-collection";

export interface ChangelogEntry {
  slug: string;
  title: string;
  date: string;
  tags: string[];
  connector?: string;
  content: string;
  html: string;
}

const collection = defineCollection<ChangelogEntry>({
  dir: "changelog",
  parse: parseEntry,
  sort: (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
});

export function getAllEntries(): ChangelogEntry[] {
  return collection.getAll();
}

function parseEntry({ slug, data, content }: ParsedFile): ChangelogEntry {
  const html = marked.parse(content) as string;

  return {
    slug,
    title: field.string(data.title, slug),
    date: field.string(data.date, new Date().toISOString().slice(0, 10)),
    tags: field.stringArray(data.tags),
    connector: data.connector as string | undefined,
    content,
    html,
  };
}
