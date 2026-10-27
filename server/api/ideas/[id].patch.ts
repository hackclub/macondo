import { and, eq } from "drizzle-orm";
import db from "../../db";
import { projectIdeaTable } from "../../db/schema";
import { getSession } from "../../lib/session";

const ACTIONS = ["save", "dismiss", "unsave"] as const;
type Action = (typeof ACTIONS)[number];

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid idea ID" });
  }

  const body = await readBody<{ action?: unknown }>(event).catch(() => ({}));
  const action = typeof body.action === "string" ? (body.action as Action) : null;
  if (!action || !ACTIONS.includes(action)) {
    throw createError({ statusCode: 400, statusMessage: "action must be save, dismiss, or unsave" });
  }

  const [existing] = await db
    .select()
    .from(projectIdeaTable)
    .where(and(eq(projectIdeaTable.id, id), eq(projectIdeaTable.user_id, user.id)))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: "Idea not found" });
  }

  const now = new Date();
  const updates: Record<string, unknown> = { updated_at: now };
  if (action === "save") {
    updates.status = "saved";
    updates.saved_at = now;
    updates.dismissed_at = null;
  } else if (action === "dismiss") {
    updates.status = "dismissed";
    updates.dismissed_at = now;
    updates.saved_at = null;
  } else {
    updates.status = "suggested";
    updates.saved_at = null;
    updates.dismissed_at = null;
  }

  const [updated] = await db
    .update(projectIdeaTable)
    .set(updates)
    .where(and(eq(projectIdeaTable.id, id), eq(projectIdeaTable.user_id, user.id)))
    .returning();

  return updated;
});
