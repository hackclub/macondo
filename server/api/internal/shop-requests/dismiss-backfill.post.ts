import db from "../../../db";
import { shopItemTable } from "../../../db/schema";
import { dismissMatchingSuggestions } from "../../../lib/shop-admin";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const items = await db
    .select({ id: shopItemTable.id, name: shopItemTable.name })
    .from(shopItemTable);

  let dismissed = 0;
  for (const item of items) {
    dismissed += await dismissMatchingSuggestions(item.name, actor.id);
  }

  return { dismissed };
});
