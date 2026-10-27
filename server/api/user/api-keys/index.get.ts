import { and, desc, eq, isNull } from "drizzle-orm";
import db from "~~/server/db";
import { apiKeyTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";

// Session-only: a leaked key must not be able to extend its own life.
type ApiKeyRow = typeof apiKeyTable.$inferSelect;

function toApiKeyListItem(row: ApiKeyRow) {
  return {
    id: row.id,
    label: row.label,
    last4: row.last4,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
  };
}

export default defineEventHandler(async (event) => {
  if (event.context.apiKeyAuth) {
    throw createError({
      statusCode: 401,
      statusMessage: "API keys cannot manage API keys",
    });
  }
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return {
    keys: (
      await db
        .select()
        .from(apiKeyTable)
        .where(
          and(eq(apiKeyTable.user_id, user.id), isNull(apiKeyTable.revoked_at)),
        )
        .orderBy(desc(apiKeyTable.created_at))
    ).map(toApiKeyListItem),
  };
});
