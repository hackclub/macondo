// The channel is user-visible: never identify the acting admin or link into /internal pages.
// Queueing never throws; publishPendingShopChanges does, so the endpoint can surface Slack failures.

import { asc, inArray } from "drizzle-orm";

import db from "../db";
import { shopPendingChangeTable } from "../db/schema";
import {
  getChangedShopItemKeys,
  getShopItemAuditMetadata,
  priceHoursToGold,
  type ShopItemRow,
} from "./shop";
import { postWebhook, type SlackBlock } from "./slack-bot";

const VALUE_MAX_CHARS = 400;
const MAX_CAROUSEL_CARDS = 10;
const MAX_SECTION_FIELDS = 25;

// Exceeding any card cap makes Slack reject the whole carousel with invalid_blocks.
const CARD_BODY_MAX = 200;
const CARD_SUBTEXT_MAX = 200;
const CARD_VALUE_BUDGETS = [VALUE_MAX_CHARS, 120, 80, 56, 40, 28, 20, 14, 10, 8];

const NONE_TEXT = "_none_";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

function escapeMrkdwn(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, " ");
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    // Relative URLs are normalized below.
  }

  if (raw.startsWith("/")) {
    return `${publicBaseUrl()}${raw}`;
  }

  return null;
}

function slackLink(value: string | null | undefined, label?: string): string {
  const url = normalizeHttpUrl(value);
  if (!url) return NONE_TEXT;
  return `<${url}|${escapeMrkdwn(label ?? url)}>`;
}

// the ellipsis counts against `max` because card caps are hard limits
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  description: "Description",
  category: "Category",
  kind: "Kind",
  price_hours: "Price",
  sale_price_hours: "Sale Price",
  grant_amount_cents: "Grant Amount",
  stock_remaining: "Stock Remaining",
  inventory_mode: "Inventory",
  available: "Public Availability",
  coming_soon: "Coming Soon",
  available_until: "Available Until",
  image_url: "Image",
  slug: "Slug",
  fulfillment_provider: "Fulfillment",
  source: "Source",
  max_per_user: "Max per user",
  requires_shipped_project: "Requires Shipped Project",
  pinned: "Pinned to top",
  extra_fruity: "Extra fruity (starfruit-gated)",
  priority_eligible: "Priority-payout eligible",
  regional_pricing: "Regional pricing",
  modifiers: "Modifiers",
  attachment_urls: "Attachment URLs",
  name_translations: "Name translations",
  description_translations: "Description translations",
  price_fruit_type: "Fruit price type",
  price_fruit_amount: "Fruit price amount",
  price_fruit_level: "Fruit price level",
  price_fruit_category: "Fruit price category",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS);

// create/delete diffs enumerate raw columns, so these need skipping here too
const SKIPPED_KEYS = new Set(["id", "created_at", "updated_at"]);

const ACTION_PRESENTATION: Record<string, { emoji: string; title: string }> = {
  create_shop_item: { emoji: "🆕", title: "New shop item" },
  update_shop_item: { emoji: "✏️", title: "Shop item updated" },
  restock_shop_item: { emoji: "📦", title: "Shop item restocked" },
  hype_shop_item: { emoji: "🔜", title: "Shop item coming soon" },
  launch_shop_item: { emoji: "🚀", title: "Shop item launched" },
  delete_shop_item: { emoji: "🗑️", title: "Shop item removed" },
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function formatEpochDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return escapeMrkdwn(String(value));
  return `<!date^${Math.floor(date.getTime() / 1000)}^{date_short_pretty} {time}|${date.toISOString()}>`;
}

function formatGoldPrice(priceHours: number): string {
  return `${priceHoursToGold(priceHours)} gold ($${priceHours})`;
}

function formatCompactJson(value: unknown): string {
  return `\`${truncate(JSON.stringify(value) ?? "null", VALUE_MAX_CHARS - 20)}\``;
}

function formatRegionalPricing(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return formatCompactJson(value);
  }
  const entries = Object.entries(
    value as Record<string, { price_hours?: number; available?: boolean }>,
  );
  if (entries.length === 0) return NONE_TEXT;
  return entries
    .map(([region, override]) => {
      if (!override || typeof override !== "object") return `${region}: default`;
      const bits: string[] = [];
      if (typeof override.price_hours === "number") {
        bits.push(formatGoldPrice(override.price_hours));
      }
      if (override.available === false) bits.push("unavailable");
      else if (override.available === true) bits.push("available");
      return `${escapeMrkdwn(region)}: ${bits.join(", ") || "default"}`;
    })
    .join(" · ");
}

function formatModifiers(value: unknown): string {
  if (!Array.isArray(value)) return formatCompactJson(value);
  if (value.length === 0) return NONE_TEXT;
  return value
    .map((modifier) => {
      const type = typeof modifier?.type === "string" ? modifier.type : "?";
      const optionCount = Array.isArray(modifier?.options)
        ? modifier.options.length
        : 0;
      const optionsBit =
        type === "text"
          ? "free text"
          : `${optionCount} option${optionCount === 1 ? "" : "s"}`;
      return `${escapeMrkdwn(typeof modifier?.label === "string" ? modifier.label : "modifier")} (${type}, ${optionsBit})`;
    })
    .join(" · ");
}

function formatTranslations(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return formatCompactJson(value);
  }
  const locales = Object.keys(value as Record<string, unknown>);
  if (locales.length === 0) return NONE_TEXT;
  return `${locales.length} locale${locales.length === 1 ? "" : "s"} (${escapeMrkdwn(locales.join(", "))})`;
}

function formatAttachmentUrls(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return NONE_TEXT;
  const links = value
    .slice(0, 3)
    .map((url, index) => slackLink(String(url), `link ${index + 1}`));
  const suffix = value.length > 3 ? ` +${value.length - 3} more` : "";
  return `${value.length} attachment${value.length === 1 ? "" : "s"}: ${links.join(", ")}${suffix}`;
}

export function formatFieldValue(key: string, value: unknown): string {
  let formatted: string;

  if (value === null || value === undefined || value === "") {
    formatted = NONE_TEXT;
  } else if (typeof value === "boolean") {
    formatted = value ? "Yes" : "No";
  } else if (
    (key === "price_hours" || key === "sale_price_hours") &&
    typeof value === "number"
  ) {
    formatted = formatGoldPrice(value);
  } else if (key === "grant_amount_cents" && typeof value === "number") {
    formatted = `$${(value / 100).toFixed(2)}`;
  } else if (key === "image_url" && typeof value === "string") {
    formatted = slackLink(value, "image");
  } else if (key === "attachment_urls") {
    formatted = formatAttachmentUrls(value);
  } else if (key === "regional_pricing") {
    formatted = formatRegionalPricing(value);
  } else if (key === "modifiers") {
    formatted = formatModifiers(value);
  } else if (key === "name_translations" || key === "description_translations") {
    formatted = formatTranslations(value);
  } else if (value instanceof Date || key === "available_until") {
    formatted = formatEpochDate(value as Date | string);
  } else if (typeof value === "number") {
    formatted = String(value);
  } else if (typeof value === "string") {
    formatted = escapeMrkdwn(value);
  } else {
    formatted = formatCompactJson(value);
  }

  return truncate(formatted, VALUE_MAX_CHARS);
}

export type ShopItemFieldDiff = {
  key: string;
  label: string;
  oldText: string | null;
  newText: string | null;
};

function sortByFieldOrder(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    return (ia === -1 ? FIELD_ORDER.length : ia) - (ib === -1 ? FIELD_ORDER.length : ib);
  });
}

function isDefaultValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (value === false) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

export function diffShopItemFields(
  prev: ShopItemRow | null,
  next: ShopItemRow | null,
): ShopItemFieldDiff[] {
  if (prev && next) {
    return sortByFieldOrder(
      getChangedShopItemKeys(prev, next).filter((key) => !SKIPPED_KEYS.has(key)),
    ).map((key) => ({
      key,
      label: fieldLabel(key),
      oldText: formatFieldValue(key, prev[key as keyof ShopItemRow]),
      newText: formatFieldValue(key, next[key as keyof ShopItemRow]),
    }));
  }

  const item = next ?? prev;
  if (!item) return [];

  const keys = sortByFieldOrder(
    Object.keys(item).filter(
      (key) =>
        !SKIPPED_KEYS.has(key) &&
        !isDefaultValue(item[key as keyof ShopItemRow]),
    ),
  );
  return keys.map((key) => ({
    key,
    label: fieldLabel(key),
    oldText: next ? null : formatFieldValue(key, item[key as keyof ShopItemRow]),
    newText: next ? formatFieldValue(key, item[key as keyof ShopItemRow]) : null,
  }));
}

function diffBodyText(diff: ShopItemFieldDiff): string {
  if (diff.oldText !== null && diff.newText !== null) {
    return `~${diff.oldText}~ → ${diff.newText}`;
  }
  if (diff.newText !== null) return diff.newText;
  return `~${diff.oldText}~`;
}

export type ShopItemChange = {
  action: string;
  oldItem: ShopItemRow | null;
  newItem: ShopItemRow | null;
};

// Date columns come back from jsonb as ISO strings
export type PendingShopChangeRow = {
  id: number;
  item_id: number;
  old_value: unknown;
  new_value: unknown;
};

// Compares the first old snapshot with the last new one; edits that cancel out drop, and the
// action is re-derived so e.g. update-then-delete announces as a removal.
export function mergePendingShopChanges(
  rows: PendingShopChangeRow[],
): ShopItemChange[] {
  const byItem = new Map<
    number,
    { oldItem: ShopItemRow | null; newItem: ShopItemRow | null }
  >();
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    const oldItem = (row.old_value ?? null) as ShopItemRow | null;
    const newItem = (row.new_value ?? null) as ShopItemRow | null;
    const existing = byItem.get(row.item_id);
    if (existing) existing.newItem = newItem;
    else byItem.set(row.item_id, { oldItem, newItem });
  }

  const changes: ShopItemChange[] = [];
  for (const { oldItem, newItem } of byItem.values()) {
    if (!oldItem && !newItem) continue;
    if (!newItem) {
      changes.push({ action: "delete_shop_item", oldItem, newItem: null });
      continue;
    }
    if (!oldItem) {
      changes.push({ action: "create_shop_item", oldItem: null, newItem });
      continue;
    }
    if (diffShopItemFields(oldItem, newItem).length === 0) continue;
    changes.push({
      action: getShopItemAuditMetadata(oldItem, newItem).action,
      oldItem,
      newItem,
    });
  }
  return changes;
}

type RenderableChange = {
  presentation: { emoji: string; title: string };
  item: ShopItemRow;
  diffs: ShopItemFieldDiff[];
  heroImageUrl: string | null;
};

function toRenderable(change: ShopItemChange): RenderableChange | null {
  // archiving hides the item, so present it publicly as a removal
  const isArchive = change.action === "archive_shop_item";
  const action = isArchive ? "delete_shop_item" : change.action;
  const newItem = isArchive ? null : change.newItem;
  const oldItem = change.oldItem;

  const item = newItem ?? oldItem;
  if (!item) return null;

  const diffs = diffShopItemFields(oldItem, newItem);
  if (diffs.length === 0) return null;

  return {
    presentation: ACTION_PRESENTATION[action] ?? {
      emoji: "🛍️",
      title: "Shop item changed",
    },
    item,
    diffs,
    heroImageUrl: normalizeHttpUrl(item.image_url),
  };
}

// a link cut mid-URL renders as raw mrkdwn, so collapse links to plain text before trimming
function unlinkForCard(text: string): string {
  return text.replace(/<[^>|]*\|([^>]*)>/g, "$1").replace(/<([^>|]+)>/g, "$1");
}

function shortenCardValue(text: string, max: number): string {
  if (text.length <= max) return text;
  const plain = unlinkForCard(text);
  return plain.length <= max ? plain : truncate(plain, max);
}

// one line per field so several fit in 200 chars; a struck "_none_" is dropped as noise
function cardDiffLine(diff: ShopItemFieldDiff, valueMax: number): string {
  const label = `*${escapeMrkdwn(diff.label)}:*`;
  const oldText =
    diff.oldText === null ? null : shortenCardValue(diff.oldText, valueMax);
  const newText =
    diff.newText === null ? null : shortenCardValue(diff.newText, valueMax);
  if (oldText !== null && newText !== null) {
    if (oldText === NONE_TEXT) return `${label} ${newText}`;
    if (newText === NONE_TEXT) return `${label} ~${oldText}~ → none`;
    return `${label} ~${oldText}~ → ${newText}`;
  }
  if (newText !== null) return `${label} ${newText}`;
  return `${label} ~${oldText}~`;
}

function joinedLength(lines: string[]): number {
  return lines.reduce((total, line) => total + line.length + 1, -1);
}

function fieldOverflowLine(count: number): string {
  return `…and ${count} more field${count === 1 ? "" : "s"}`;
}

function distributeCardLines(
  lines: string[],
  allowSubtext: boolean,
): { body: string[]; subtext: string[]; hidden: number } {
  const body: string[] = [];
  const subtext: string[] = [];
  let index = 0;
  for (; index < lines.length; index++) {
    if (joinedLength([...body, lines[index]!]) > CARD_BODY_MAX) break;
    body.push(lines[index]!);
  }
  if (allowSubtext) {
    for (; index < lines.length; index++) {
      if (joinedLength([...subtext, lines[index]!]) > CARD_SUBTEXT_MAX) break;
      subtext.push(lines[index]!);
    }
  }
  return { body, subtext, hidden: lines.length - index };
}

// Values shrink until all fields fit; hidden fields are counted on the card, never silently lost.
function packCardText(
  diffs: ShopItemFieldDiff[],
  allowSubtext: boolean,
): { body: string; subtext: string | null } {
  let packed = distributeCardLines(
    diffs.map((diff) => cardDiffLine(diff, VALUE_MAX_CHARS)),
    allowSubtext,
  );
  for (const budget of CARD_VALUE_BUDGETS) {
    if (packed.hidden === 0) break;
    packed = distributeCardLines(
      diffs.map((diff) => cardDiffLine(diff, budget)),
      allowSubtext,
    );
  }

  const { body, subtext } = packed;
  if (body.length === 0 && diffs[0]) {
    body.push(truncate(cardDiffLine(diffs[0], CARD_BODY_MAX), CARD_BODY_MAX));
    packed.hidden = Math.max(0, diffs.length - 1);
  }

  if (packed.hidden > 0) {
    const container = allowSubtext ? subtext : body;
    const tailMax = allowSubtext ? CARD_SUBTEXT_MAX : CARD_BODY_MAX;
    let hidden = packed.hidden;
    while (
      container.length > 0 &&
      joinedLength([...container, fieldOverflowLine(hidden)]) > tailMax
    ) {
      container.pop();
      hidden++;
    }
    if (joinedLength([...container, fieldOverflowLine(hidden)]) <= tailMax) {
      container.push(fieldOverflowLine(hidden));
    }
  }

  return {
    body: body.join("\n"),
    subtext: subtext.length > 0 ? subtext.join("\n") : null,
  };
}

function buildCarouselCards(
  renderable: RenderableChange[],
  allowSubtext: boolean,
): SlackBlock[] {
  const visible =
    renderable.length > MAX_CAROUSEL_CARDS
      ? renderable.slice(0, MAX_CAROUSEL_CARDS - 1)
      : renderable;
  const overflow = renderable.slice(visible.length);

  const cards: SlackBlock[] = visible.map((change) => {
    const { presentation, item, diffs, heroImageUrl } = change;
    const { body, subtext } = packCardText(diffs, allowSubtext);
    const card: SlackBlock = {
      type: "card",
      block_id: `shop-item-${item.id}`,
      title: {
        type: "mrkdwn",
        text: `*${truncate(escapeMrkdwn(item.name), 150 - 2)}*`, // card title cap minus the bold asterisks
        verbatim: false,
      },
      subtitle: {
        type: "mrkdwn",
        text: truncate(
          `${presentation.emoji} ${presentation.title}`,
          150, // card subtitle cap
        ),
        verbatim: false,
      },
      body: { type: "mrkdwn", text: body, verbatim: false },
    };
    if (subtext) {
      card.subtext = { type: "mrkdwn", text: subtext, verbatim: false };
    }
    // Slack's image URL cap; an over-long one would take the whole carousel down
    if (heroImageUrl && heroImageUrl.length <= 3000) {
      card.hero_image = {
        type: "image",
        image_url: heroImageUrl,
        alt_text: truncate(item.name, 2000),
      };
    }
    return card;
  });

  if (overflow.length > 0) {
    cards.push({
      type: "card",
      block_id: "shop-pending-overflow",
      title: {
        type: "mrkdwn",
        text: `*…and ${overflow.length} more item${overflow.length === 1 ? "" : "s"}*`,
        verbatim: false,
      },
      subtitle: { type: "mrkdwn", text: "🛍️ Shop changes", verbatim: false },
      body: {
        type: "mrkdwn",
        text: truncate(
          overflow.map((change) => escapeMrkdwn(change.item.name)).join(", "),
          CARD_BODY_MAX,
        ),
        verbatim: false,
      },
    });
  }

  return cards;
}

// fallback for clients that reject carousel blocks
function buildSectionStyleBlocks(renderable: RenderableChange[]): SlackBlock[] {
  const visible = renderable.slice(0, 15); // max items in the sections fallback
  const itemOverflow = renderable.length - visible.length;

  const lines: string[] = [];
  for (const { presentation, item, diffs } of visible) {
    lines.push(
      `*${presentation.emoji} ${presentation.title}: ${escapeMrkdwn(item.name)}*`,
    );
    for (const diff of diffs.slice(0, MAX_SECTION_FIELDS)) {
      lines.push(`*${escapeMrkdwn(diff.label)}:* ${diffBodyText(diff)}`);
    }
    const fieldOverflow = diffs.length - MAX_SECTION_FIELDS;
    if (fieldOverflow > 0) {
      lines.push(`…and ${fieldOverflow} more field${fieldOverflow === 1 ? "" : "s"}`);
    }
  }

  const headline =
    visible.length === 1 && visible[0]
      ? `${visible[0].presentation.emoji} ${visible[0].presentation.title}: ${visible[0].item.name}`
      : `🛍️ Shop changes: ${renderable.length} items`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: truncate(headline, 150), emoji: true },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${publicBaseUrl()}/shop|Visit the shop> · ${formatEpochDate(new Date())}`,
        },
      ],
    },
  ];

  let chunk = "";
  for (const line of lines) {
    if (chunk && chunk.length + line.length + 1 > 2900) { // max chars per section block
      blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
      chunk = "";
    }
    chunk = chunk ? `${chunk}\n${line}` : line;
  }
  if (chunk) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
  }

  if (itemOverflow > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `…and ${itemOverflow} more item${itemOverflow === 1 ? "" : "s"}`,
        },
      ],
    });
  }

  return blocks;
}

export function buildShopItemLogBlocks(args: {
  changes: ShopItemChange[];
  style?: "carousel" | "sections";
  // off for the retry that keeps cards but skips the newer subtext field
  allowSubtext?: boolean;
}): { blocks: SlackBlock[] } | null {
  const style = args.style ?? "carousel";
  const renderable = args.changes
    .map(toRenderable)
    .filter((change): change is RenderableChange => change !== null);
  if (renderable.length === 0) return null;

  const blocks: SlackBlock[] =
    style === "carousel"
      ? [
          {
            type: "carousel",
            elements: buildCarouselCards(renderable, args.allowSubtext ?? true),
          },
        ]
      : buildSectionStyleBlocks(renderable);

  // a literal "@channel" would not ping anyone
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "<!channel>" }],
  });

  return { blocks };
}

export type PendingShopChangeSummary = {
  itemId: number;
  itemName: string;
  action: string;
  title: string;
  emoji: string;
  fields: string[];
};

export function describeShopItemChange(
  change: ShopItemChange,
): PendingShopChangeSummary | null {
  const renderable = toRenderable(change);
  if (!renderable) return null;
  return {
    itemId: renderable.item.id,
    itemName: renderable.item.name,
    action: change.action,
    title: renderable.presentation.title,
    emoji: renderable.presentation.emoji,
    fields: renderable.diffs.map((diff) => diff.label),
  };
}

export async function queueShopItemChange(change: ShopItemChange): Promise<void> {
  try {
    // the PATCH endpoint fires on every save, changed or not
    if (
      change.oldItem &&
      change.newItem &&
      diffShopItemFields(change.oldItem, change.newItem).length === 0
    ) {
      return;
    }

    const item = change.newItem ?? change.oldItem;
    if (!item) return;

    await db.insert(shopPendingChangeTable).values({
      item_id: item.id,
      action: change.action,
      old_value: change.oldItem,
      new_value: change.newItem,
    });
  } catch (error) {
    console.warn("[shop-slack-log] failed to queue shop item change", error);
  }
}

export async function listPendingShopChanges(): Promise<PendingShopChangeSummary[]> {
  return mergePendingShopChanges(
    await db
      .select()
      .from(shopPendingChangeTable)
      .orderBy(asc(shopPendingChangeTable.id)),
  )
    .map(describeShopItemChange)
    .filter((summary): summary is PendingShopChangeSummary => summary !== null);
}

// Webhooks report bad blocks as invalid_payload; other errors would just fail again on retry.
function isBlockRejection(error: string | undefined): boolean {
  return error === "invalid_blocks" || error === "invalid_payload";
}

// Only the rows read here are deleted, so changes queued mid-post survive; on failure the queue is kept.
export async function publishPendingShopChanges(): Promise<{ published: number }> {
  const config = useRuntimeConfig();
  const webhookUrl = ((config.slackShopLogWebhookUrl as string | undefined) ?? "").trim();
  if (!webhookUrl) {
    throw createError({
      statusCode: 503,
      statusMessage: "Shop log Slack webhook is not configured",
    });
  }

  const rows = await db
    .select()
    .from(shopPendingChangeTable)
    .orderBy(asc(shopPendingChangeTable.id));
  if (rows.length === 0) return { published: 0 };

  const changes = mergePendingShopChanges(rows);

  // carousel and subtext are newer Block Kit surfaces, so degrade one step at a time
  const variants: SlackBlock[][] = [];
  for (const built of [
    buildShopItemLogBlocks({ changes, style: "carousel" }),
    buildShopItemLogBlocks({ changes, style: "carousel", allowSubtext: false }),
    buildShopItemLogBlocks({ changes, style: "sections" }),
  ]) {
    if (!built) continue;
    const serialized = JSON.stringify(built.blocks);
    if (variants.some((blocks) => JSON.stringify(blocks) === serialized)) continue;
    variants.push(built.blocks);
  }

  if (variants.length > 0) {
    let result = await postWebhook(webhookUrl, {
      blocks: variants[0]!,
      unfurl_links: false,
      unfurl_media: false,
    });

    for (
      let index = 1;
      index < variants.length && !result.ok && isBlockRejection(result.error);
      index++
    ) {
      console.warn(
        "[shop-slack-log] Slack rejected the blocks, retrying with a simpler layout",
      );
      result = await postWebhook(webhookUrl, {
        blocks: variants[index]!,
        unfurl_links: false,
        unfurl_media: false,
      });
    }

    if (!result.ok) {
      throw createError({
        statusCode: 502,
        statusMessage: `Slack rejected the announcement: ${result.error}`,
      });
    }
  }

  await db
    .delete(shopPendingChangeTable)
    .where(inArray(shopPendingChangeTable.id, rows.map((row) => row.id)));

  return { published: changes.length };
}
