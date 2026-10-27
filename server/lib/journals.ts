import { and, desc, eq } from "drizzle-orm";

import db from "../db";
import { journalsTable, users } from "../db/schema";

export async function getProjectJournals(projectId: number, options?: { includeArchived?: boolean }) {
  const whereClause = options?.includeArchived
    ? eq(journalsTable.project_id, projectId)
    : and(
        eq(journalsTable.project_id, projectId),
        eq(journalsTable.archived, false),
      );

  return await db
    .select({
      id: journalsTable.id,
      short_brief: journalsTable.short_brief,
      long_brief: journalsTable.long_brief,
      hours: journalsTable.hours,
      created_at: journalsTable.created_at,
      archived: journalsTable.archived,
      archived_at: journalsTable.archived_at,
      content_language: journalsTable.content_language,
      // Never expose users.name (PII); render sites fall back to slack_id.
      author_id: journalsTable.user_id,
      author_username: users.username,
      author_slack_id: users.slack_id,
      author_image: users.image,
    })
    .from(journalsTable)
    .leftJoin(users, eq(users.id, journalsTable.user_id))
    .where(whereClause)
    .orderBy(desc(journalsTable.created_at), desc(journalsTable.id));
}
