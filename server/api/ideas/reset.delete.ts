import { eq } from "drizzle-orm";
import db from "../../db";
import { projectIdeaTable } from "../../db/schema";
import { getSession } from "../../lib/session";

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  return {
    deleted: (
      await db
        .delete(projectIdeaTable)
        .where(eq(projectIdeaTable.user_id, user.id))
        .returning({ id: projectIdeaTable.id })
    ).length,
  };
});
