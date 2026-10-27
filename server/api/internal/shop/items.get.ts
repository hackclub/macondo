import { desc } from "drizzle-orm";

import db from "../../../db";
import { shopItemTable } from "../../../db/schema";
import { canAccessInternalShopAdmin } from "../../../policies/internal";
import { formatShopItemForResponse } from "../../../lib/shop";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return (
    await db
      .select()
      .from(shopItemTable)
      .orderBy(desc(shopItemTable.updated_at), desc(shopItemTable.created_at))
  ).map((item) => formatShopItemForResponse(item));
});
