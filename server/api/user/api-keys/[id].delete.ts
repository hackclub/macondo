import { and, eq, isNull } from "drizzle-orm";
import db from "~~/server/db";
import { apiKeyTable } from "~~/server/db/schema";
import { invalidateApiKeyCache } from "~~/server/lib/api-keys";
import { writeAudit } from "~~/server/lib/audit";
import { getSession } from "~~/server/lib/session";

// Session-only. Soft-deleted so the row stays for the audit trail.
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

  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "No key id." });
  }

  const [revoked] = await db
    .update(apiKeyTable)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(apiKeyTable.id, id),
        eq(apiKeyTable.user_id, user.id),
        isNull(apiKeyTable.revoked_at),
      ),
    )
    .returning({ id: apiKeyTable.id, label: apiKeyTable.label, last4: apiKeyTable.last4 });

  if (!revoked) {
    // Also covers "someone else's key": same 404 so existence never leaks.
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  // The cache is keyed by token hash, so clear it all; other replicas self-heal within the TTL.
  invalidateApiKeyCache();

  try {
    await writeAudit({
      actor_id: user.id,
      action: "api_key.revoke",
      entity_type: "api_key",
      entity_id: id,
      old_value: { label: revoked.label, last4: revoked.last4 },
      new_value: null,
      sensitive: true,
      public_message: `Revoked API key "${revoked.label}"`,
    });
  } catch (err) {
    console.error("[api-keys] audit revoke failed", err);
  }

  return { ok: true };
});
