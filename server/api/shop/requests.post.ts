import { and, eq, gte, isNull, ne, sql } from "drizzle-orm";

import db from "../../db";
import { shopItemRequestTable } from "../../db/schema";
import { tagShopRequest } from "../../lib/shop-request-tag";
import { getSession } from "../../lib/session";

function sanitizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (trimmed.length > 500) return null; // max url length
  return trimmed;
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const body = (await readBody<{
    name?: string;
    description?: string | null;
    store_url?: string | null;
    image_url?: string | null;
    show_username?: boolean | null;
  }>(event)) ?? {};

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2 || name.length > 120) {
    throw createError({
      statusCode: 400,
      statusMessage: "Item name must be between 2 and 120 characters.",
    });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 2000)
      : null;

  const storeUrl = sanitizeUrl(body.store_url);

  const [recentCountRow] = await db
    .select({ count: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(shopItemRequestTable)
    .where(
      and(
        eq(shopItemRequestTable.user_id, user.id),
        gte(shopItemRequestTable.created_at, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)), // one week ago
        isNull(shopItemRequestTable.dismissed_at),
      ),
    );

  if ((recentCountRow?.count ?? 0) >= 7) { // max requests per user per week
    throw createError({
      statusCode: 429,
      statusMessage:
        "You can request up to 7 items per week. Please try again later.",
    });
  }

  const [inserted] = await db
    .insert(shopItemRequestTable)
    .values({
      user_id: user.id,
      name,
      description,
      store_url: storeUrl,
      image_url: sanitizeUrl(body.image_url),
      show_username: body.show_username === true,
    })
    .returning({ id: shopItemRequestTable.id });

  const requestId = inserted?.id;
  if (!requestId) {
    throw createError({ statusCode: 500, statusMessage: "Failed to save request" });
  }

  // Tagged synchronously so the suggestion lands in the right bucket on submit.
  try {
    // Existing tags steer the model away from near-duplicates (Keyboards vs Keyboard).
    const existingTags = (
      await db
        .select({ tag: shopItemRequestTable.group_tag })
        .from(shopItemRequestTable)
        .where(
          and(
            ne(shopItemRequestTable.id, requestId),
            isNull(shopItemRequestTable.dismissed_at),
          ),
        )
    )
      .map((r) => r.tag)
      .filter((t): t is string => t != null);

    const tag = await tagShopRequest(name, description, storeUrl, existingTags);
    if (tag) {
      await db
        .update(shopItemRequestTable)
        .set({ group_tag: tag })
        .where(eq(shopItemRequestTable.id, requestId));
    }
  } catch (err) {
    // Non-fatal: the row is saved and admins can backfill tags later.
    console.warn("[shop-requests.submit] AI tag failed for request", requestId, err);
  }

  return { ok: true, id: requestId };
});
