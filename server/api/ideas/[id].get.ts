import { and, eq } from "drizzle-orm";
import db from "../../db";
import { projectIdeaTable } from "../../db/schema";
import { getSession } from "../../lib/session";

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid idea ID" });
  }

  const [row] = await db
    .select()
    .from(projectIdeaTable)
    .where(and(eq(projectIdeaTable.id, id), eq(projectIdeaTable.user_id, user.id)))
    .limit(1);

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Idea not found" });
  }

  return row;
});
