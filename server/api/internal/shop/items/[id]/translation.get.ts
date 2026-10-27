import { eq } from "drizzle-orm";

import db from "../../../../../db";
import { shopItemTable } from "../../../../../db/schema";
import { canAccessInternalShopAdmin } from "../../../../../policies/internal";
import { translateShopItem } from "../../../../../lib/translate-shop";

const SUPPORTED_LOCALES = new Set(["en", "es"]);

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid item ID" });
  }

  const locale = String(getQuery(event).locale ?? "").trim().toLowerCase();
  if (!SUPPORTED_LOCALES.has(locale)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Unsupported target locale",
    });
  }

  const [item] = await db
    .select({
      id: shopItemTable.id,
      name: shopItemTable.name,
      description: shopItemTable.description,
    })
    .from(shopItemTable)
    .where(eq(shopItemTable.id, id))
    .limit(1);

  if (!item) {
    throw createError({ statusCode: 404, statusMessage: "Shop item not found" });
  }

  // No `overrides`, so the admin sees the raw AI output rather than the stored translation.
  const result = await translateShopItem(
    item.id,
    locale,
    item.name,
    item.description ?? null,
  );

  return {
    locale,
    name: result.name,
    description: result.description,
  };
});
