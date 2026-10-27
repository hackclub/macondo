import { and, eq } from "drizzle-orm";
import db from "~~/server/db";
import { projectNotesTable } from "~~/server/db/schema";
import { getSession } from "~~/server/lib/session";
import { getProjectForMember } from "~~/server/lib/projects";

// Notes are private per (user, project); gated on membership so non-members can't probe.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  if (!(await getProjectForMember(user.id, id))) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const [row] = await db
    .select({ note: projectNotesTable.note })
    .from(projectNotesTable)
    .where(
      and(
        eq(projectNotesTable.user_id, user.id),
        eq(projectNotesTable.project_id, id),
      ),
    )
    .limit(1);

  return { note: row?.note ?? "" };
});
