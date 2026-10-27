export type InternalEntityType =
  | "ship"
  | "project"
  | "user"
  | "order"
  | "shop_item"
  | "support_ticket";

export function normalizeInternalEntityType(
  raw: string | null | undefined,
): InternalEntityType | null {
  if (!raw) return null;
  switch (raw.trim().toLowerCase().replace(/\s+/g, "_")) {
    case "ship":
      return "ship";
    case "project":
      return "project";
    case "user":
      return "user";
    case "order":
    case "shop_order":
      return "order";
    case "item":
    case "shop_item":
      return "shop_item";
    case "ticket":
    case "support_ticket":
      return "support_ticket";
    default:
      return null;
  }
}

// null means callers render plain text.
export function internalEntityHref(
  type: string | null | undefined,
  id: string | number | null | undefined,
): string | null {
  const canonical = normalizeInternalEntityType(type);
  if (!canonical) return null;
  if (id === null || id === undefined) return null;
  const idStr = String(id).trim();
  if (!idStr) return null;
  switch (canonical) {
    case "ship":
      return null;
    case "project":
      return `/internal/projects/${idStr}`;
    case "user":
      return `/internal/users/${idStr}`;
    case "order":
      return `/internal/orders/${idStr}`;
    case "shop_item":
      return `/internal/shop/${idStr}`;
    case "support_ticket":
      return `/internal/support/${idStr}`;
  }
}

export function internalEntityLabel(
  type: string | null | undefined,
  id: string | number | null | undefined,
): string {
  const idStr = id === null || id === undefined ? "" : String(id).trim();
  switch (normalizeInternalEntityType(type)) {
    case "ship":
      return `Ship #${idStr}`;
    case "project":
      return `Project #${idStr}`;
    case "order":
      return `Order #${idStr}`;
    case "shop_item":
      return `Item #${idStr}`;
    case "support_ticket":
      return `Ticket #${idStr}`;
    case "user":
      return idStr ? `User ${idStr}` : "User";
    default:
      return idStr ? `#${idStr}` : "";
  }
}

export type LinkifySegment =
  | { kind: "text"; value: string }
  | { kind: "ref"; entityType: InternalEntityType; id: string; raw: string };

// Requires "#" so prose like "order 50 units" doesn't match; multi-word keywords first for longest match.
const INLINE_REF_PATTERN =
  /\b(support ticket|shop item|ship|project|order|ticket|item)\s*#\s*(\d+)/gi;

// Fresh regex per call so concurrent SSR renders never share lastIndex state.
export function parseInternalEntityRefs(
  text: string | null | undefined,
): LinkifySegment[] {
  if (!text) return [];
  const segments: LinkifySegment[] = [];
  const pattern = new RegExp(INLINE_REF_PATTERN.source, "gi");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const entityType = normalizeInternalEntityType(match[1]);
    if (!entityType) continue;
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: text.slice(lastIndex, match.index) });
    }
    segments.push({ kind: "ref", entityType, id: match[2]!, raw });
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }
  return segments;
}
