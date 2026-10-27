import { desc, eq } from "drizzle-orm";

import db from "../../../db";
import { supportTicketTable } from "../../../db/schema";
import { getSession } from "../../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return {
    items: await db
      .select()
      .from(supportTicketTable)
      .where(eq(supportTicketTable.user_id, user.id))
      .orderBy(desc(supportTicketTable.id))
      .limit(100),
  };
});
