import manifest from "#docs-manifest";
import type { MDCRoot } from "@nuxtjs/mdc";

export interface ArchiveDoc {
  [key: string]: unknown;
  requiresJournal?: boolean;
  path: string;
  asset: string;
  title: string;
  description?: string;
  keywords?: string;
  section?: string;
  order?: number;
  icon?: string;
  group?: string;
  groupTitle?: string;
  groupOrder?: number;
}

export interface ArchivePage extends ArchiveDoc {
  body: MDCRoot;
}

export function archiveDocs(locale: string): ArchiveDoc[] {
  return (manifest as unknown as Record<string, ArchiveDoc[]>)[locale === "es" ? "es" : "en"]!;
}

export async function archivePage(locale: string, path: string): Promise<ArchivePage | null> {
  const doc = archiveDocs(locale).find(doc => doc.path === path);
  return doc ? await $fetch<ArchivePage>(doc.asset) : null;
}
