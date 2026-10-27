import { and, desc, eq } from "drizzle-orm";

import db from "../../../../../db";
import { auditLogTable, shopItemTable, users } from "../../../../../db/schema";
import { formatShopItemForResponse } from "../../../../../lib/shop";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item ID" });
  }

  const [item, audits] = await Promise.all([
    db
      .select()
      .from(shopItemTable)
      .where(eq(shopItemTable.id, id))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        id: auditLogTable.id,
        action: auditLogTable.action,
        entity_id: auditLogTable.entity_id,
        old_value: auditLogTable.old_value,
        new_value: auditLogTable.new_value,
        public_message: auditLogTable.public_message,
        change_summary: auditLogTable.change_summary,
        created_at: auditLogTable.created_at,
        actor: {
          id: users.id,
          name: users.name,
          image: users.image,
          username: users.username,
        },
      })
      .from(auditLogTable)
      .leftJoin(users, eq(auditLogTable.actor_id, users.id))
      .where(
        and(
          eq(auditLogTable.entity_type, "shop_item"),
          eq(auditLogTable.entity_id, String(id)),
        ),
      )
      .orderBy(desc(auditLogTable.created_at)),
  ]);

  if (!item) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }

  return {
    item: formatShopItemForResponse(item),
    audits: audits.map((entry) => ({
      ...entry,
      actor: entry.actor?.id ? entry.actor : null,
    })),
  };
});
