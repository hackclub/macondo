import { eq } from "drizzle-orm";

import db from "../../../../db";
import { projectGrantTable } from "../../../../db/schema";
import {
  fetchHcbGrantInfoById,
  hcbGrantFetchErrorInfo,
  type HcbGrantInfo,
} from "../../../../lib/shop";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

// Fetched per row on expand: each lookup is its own HCB call and the queue can hold hundreds of grants.
export default defineEventHandler(async (event): Promise<HcbGrantInfo> => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid grant ID" });
  }

  const [grant] = await db
    .select({ hcb_grant_id: projectGrantTable.hcb_grant_id })
    .from(projectGrantTable)
    .where(eq(projectGrantTable.id, id))
    .limit(1);

  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: "Grant not found" });
  }
  if (!grant.hcb_grant_id) {
    throw createError({
      statusCode: 400,
      statusMessage: "Grant has no HCB card yet.",
    });
  }

  // Return HCB failures as fetch_error in the payload rather than a 5xx so the rest of the page still works.
  try {
    return await fetchHcbGrantInfoById(grant.hcb_grant_id);
  } catch (err) {
    return hcbGrantFetchErrorInfo(grant.hcb_grant_id, err);
  }
});
