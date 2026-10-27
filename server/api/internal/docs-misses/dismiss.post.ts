import { and, eq, isNull } from "drizzle-orm";

import db from "../../../db";
import { docsSearchMissesTable } from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { canManageInternalFAQ } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageInternalFAQ(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{ query?: unknown; locale?: unknown }>(event);
  const query = typeof body?.query === "string" ? body.query.trim().toLowerCase() : "";
  const locale: "en" | "es" =
    typeof body?.locale === "string" && body.locale === "es" ? "es" : "en";

  if (!query) {
    throw createError({ statusCode: 400, statusMessage: "Missing query" });
  }

  // stamp instead of deleting so the historical signal is kept
  const result = await db
    .update(docsSearchMissesTable)
    .set({ dismissed_at: new Date(), dismissed_by_user_id: actor.id })
    .where(
      and(
        eq(docsSearchMissesTable.query, query),
        eq(docsSearchMissesTable.locale, locale),
        isNull(docsSearchMissesTable.dismissed_at),
      ),
    )
    .returning({ id: docsSearchMissesTable.id });

  await writeAudit({
    actor_id: actor.id,
    action: "dismiss_docs_search_miss",
    entity_type: "docs_search_miss",
    entity_id: `${locale}:${query}`,
    new_value: { count: result.length },
    public_message: null,
  });

  return { dismissed: result.length };
});
