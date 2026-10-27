import { desc } from "drizzle-orm";

import db from "../../../../db";
import { userBackupTable } from "../../../../db/schema";
import { canNukeUser } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  if (!canNukeUser(event.context.user)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);

  const rows = await db
    .select({
      id: userBackupTable.id,
      original_user_id: userBackupTable.original_user_id,
      original_email: userBackupTable.original_email,
      original_name: userBackupTable.original_name,
      nuked_by_user_id: userBackupTable.nuked_by_user_id,
      nuked_by_name: userBackupTable.nuked_by_name,
      nuked_at: userBackupTable.nuked_at,
      reason: userBackupTable.reason,
      restored_at: userBackupTable.restored_at,
      restored_by_user_id: userBackupTable.restored_by_user_id,
    })
    .from(userBackupTable)
    .orderBy(desc(userBackupTable.nuked_at))
    .limit(Math.min(Number(query.limit) || 50, 200)) // default 50, max 200 per page
    .offset(Math.max(Number(query.offset) || 0, 0));

  return {
    backups: query.includeRestored === "true" ? rows : rows.filter(r => !r.restored_at),
  };
});
