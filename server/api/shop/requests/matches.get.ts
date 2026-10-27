import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";

import db from "../../../db";
import { shopItemRequestTable } from "../../../db/schema";
import { tagShopRequestByKeywords } from "../../../lib/shop-request-tag";

function normalizeText(raw: string) {
  return raw.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(raw: string) {
  return normalizeText(raw)
    .split(/\s+/)
    .filter((token) => token.length >= 3) // ignore very short tokens
    .slice(0, 6); // cap query tokens
}

function scoreMatch(
  query: string,
  queryTokens: string[],
  queryTag: string | null,
  row: { name: string; description: string | null; group_tag: string | null; upvote_count: number },
) {
  const normalizedName = normalizeText(row.name);
  const nameTokens = new Set(tokenize(row.name));
  const descriptionTokens = new Set(tokenize(row.description ?? ""));

  let overlap = 0;
  for (const token of queryTokens) {
    if (nameTokens.has(token) || descriptionTokens.has(token)) overlap++;
  }

  const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
  const exact = normalizedName === query;
  const substring =
    query.length >= 4 && (normalizedName.includes(query) || query.includes(normalizedName));
  const sameTag = queryTag != null && row.group_tag === queryTag;

  const relevant =
    exact ||
    substring ||
    (overlap >= 2 && overlapRatio >= 0.5) ||
    (queryTokens.length === 1 && overlap === 1 && nameTokens.has(queryTokens[0]!)) ||
    (sameTag && overlap >= 1);

  if (!relevant) return -1;

  return (
    (exact ? 100 : 0) +
    (substring ? 35 : 0) +
    (sameTag ? 12 : 0) +
    overlap * 10 +
    overlapRatio * 20 +
    Math.min(row.upvote_count, 20) * 0.1
  );
}

export default defineEventHandler(async (event) => {
  const q = String(getQuery(event).q ?? "").trim();
  const normalizedQuery = normalizeText(q);
  const tokens = tokenize(q);
  const queryTag = tagShopRequestByKeywords(q, null);

  if (tokens.length === 0) return { items: [] };

  const matches = tokens.map((token) => {
    const pattern = `%${token}%`;
    return or(
      ilike(shopItemRequestTable.name, pattern),
      ilike(shopItemRequestTable.description, pattern),
      ilike(shopItemRequestTable.group_tag, pattern),
    );
  });
  const matchWhere = matches.length === 1 ? matches[0]! : or(matches[0]!, ...matches.slice(1));

  return {
    items: (
      await db
        .select({
          id: shopItemRequestTable.id,
          name: shopItemRequestTable.name,
          description: shopItemRequestTable.description,
          group_tag: shopItemRequestTable.group_tag,
          upvote_count: shopItemRequestTable.upvote_count,
        })
        .from(shopItemRequestTable)
        .where(
          and(
            isNull(shopItemRequestTable.dismissed_at),
            isNull(shopItemRequestTable.promoted_to_item_id),
            queryTag
              ? or(matchWhere, eq(shopItemRequestTable.group_tag, queryTag))
              : matchWhere,
          ),
        )
        .orderBy(desc(shopItemRequestTable.upvote_count), desc(shopItemRequestTable.created_at))
        .limit(40) // candidate pool before ranking
    )
      .map((row) => ({ row, score: scoreMatch(normalizedQuery, tokens, queryTag, row) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score || b.row.upvote_count - a.row.upvote_count)
      .slice(0, 5) // top matches returned
      .map((entry) => entry.row),
  };
});
