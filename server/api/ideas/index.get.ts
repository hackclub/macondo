import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import db from "../../db";
import { projectIdeaTable, projectTable } from "../../db/schema";
import { getSession } from "../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const rawRows = await db
    .select()
    .from(projectIdeaTable)
    .where(eq(projectIdeaTable.user_id, user.id))
    .orderBy(desc(projectIdeaTable.generated_at));

  const linkedProjectIds = Array.from(
    new Set(
      rawRows
        .map((r) => r.existing_project_id)
        .filter((id): id is number => typeof id === "number" && id > 0),
    ),
  );
  const projectNameById = new Map<number, string>();
  if (linkedProjectIds.length > 0) {
    const projectRows = await db
      .select({ id: projectTable.id, name: projectTable.name })
      .from(projectTable)
      .where(
        and(
          inArray(projectTable.id, linkedProjectIds),
          isNull(projectTable.deleted_at),
        ),
      );
    for (const p of projectRows) projectNameById.set(p.id, p.name);
  }

  const rows = rawRows.map((r) => ({
    ...r,
    existing_project_name:
      r.existing_project_id != null
        ? projectNameById.get(r.existing_project_id) ?? null
        : null,
  }));

  return {
    current: rows.find((r) => r.status === "suggested") ?? null,
    saved: rows.filter((r) => r.status === "saved"),
    hasHackatimeToken: !!user.hackatime_oauth_token,
  };
});
