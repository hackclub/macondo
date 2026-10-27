export interface DocSection {
  key: string;
  labelKey: string;
  accent: string;
  accentHex: string;
  icon: string;
  order: number;
}

// Strictly monochrome brown; accentHex stays so consuming templates don't need to branch.
const BROWN = "#684D3A";
export const docSections: readonly DocSection[] = [
  { key: "start",     labelKey: "docs_nav.start",     accent: "ds-brown", accentHex: BROWN, icon: "sparkles",      order: 0 },
  { key: "project",   labelKey: "docs_nav.project",   accent: "ds-brown", accentHex: BROWN, icon: "folder-kanban", order: 1 },
  { key: "software",  labelKey: "docs_nav.software",  accent: "ds-brown", accentHex: BROWN, icon: "code",          order: 2 },
  { key: "hardware",  labelKey: "docs_nav.hardware",  accent: "ds-brown", accentHex: BROWN, icon: "wrench",        order: 3 },
  { key: "guides",    labelKey: "docs_nav.guides",    accent: "ds-brown", accentHex: BROWN, icon: "book-open",     order: 4 },
  { key: "shipping",  labelKey: "docs_nav.shipping",  accent: "ds-brown", accentHex: BROWN, icon: "package",       order: 5 },
  { key: "currency",  labelKey: "docs_nav.currency",  accent: "ds-brown", accentHex: BROWN, icon: "coins",         order: 6 },
  { key: "help",      labelKey: "docs_nav.help",      accent: "ds-brown", accentHex: BROWN, icon: "life-buoy",     order: 7 },
] as const;

export function getSection(key: string | undefined): DocSection {
  return docSections.find((s) => s.key === key) ?? docSections[docSections.length - 1];
}
