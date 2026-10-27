import { desc, eq } from "drizzle-orm";

import db from "~~/server/db";
import { announcementTable, users } from "~~/server/db/schema";
import { canManageAnnouncements } from "~~/server/policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageAnnouncements(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  return {
    items: await db
      .select({
        id: announcementTable.id,
        title_en: announcementTable.title_en,
        body_en: announcementTable.body_en,
        recipient_count: announcementTable.recipient_count,
        created_at: announcementTable.created_at,
        created_by: announcementTable.created_by,
        author_name: users.name,
      })
      .from(announcementTable)
      .leftJoin(users, eq(users.id, announcementTable.created_by))
      .orderBy(desc(announcementTable.id))
      .limit(50),
  };
});
