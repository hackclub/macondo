import { and, eq, isNull, sql } from "drizzle-orm";
import db from "../../../db";
import {
  notificationTable,
  projectTable,
  projectUpvotesTable,
} from "../../../db/schema";
import { getSession } from "../../../lib/session";
import { notify } from "../../../lib/notify";
import { publishEvent } from "../../../lib/realtime";
import { getDisplayName } from "../../../lib/user";

// Self-upvotes are silent no-ops; the owner is only notified once per upvoter so re-upvotes never spam.

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }
  if (user.hca_verification_status !== "verified") {
    throw createError({
      statusCode: 403,
      statusMessage: "HCA verification required",
    });
  }

  const projectId = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(projectId) || projectId <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project id" });
  }

  const [project] = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      user_id: projectTable.user_id,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deleted_at),
      ),
    )
    .limit(1);
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const isSelf = project.user_id === user.id;

  const [existing] = await db
    .select({
      id: projectUpvotesTable.id,
      first_upvoted_at: projectUpvotesTable.first_upvoted_at,
    })
    .from(projectUpvotesTable)
    .where(
      and(
        eq(projectUpvotesTable.project_id, projectId),
        eq(projectUpvotesTable.user_id, user.id),
      ),
    )
    .limit(1);

  let upvoted: boolean;
  let firedNotification = false;

  if (existing) {
    await db
      .delete(projectUpvotesTable)
      .where(eq(projectUpvotesTable.id, existing.id));
    upvoted = false;
  } else if (isSelf) {
    upvoted = false;
  } else {
    try {
      await db.insert(projectUpvotesTable).values({
        project_id: projectId,
        user_id: user.id,
        first_upvoted_at: new Date(),
      });
      upvoted = true;
      firedNotification = true;
    } catch (err: unknown) {
      // 23505: a concurrent toggle beat us to the INSERT, so treat it as a toggle-off.
      const msg = String((err as { code?: string; message?: string })?.message ?? "");
      if ((err as { code?: string })?.code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
        const [row] = await db
          .select({ id: projectUpvotesTable.id })
          .from(projectUpvotesTable)
          .where(
            and(
              eq(projectUpvotesTable.project_id, projectId),
              eq(projectUpvotesTable.user_id, user.id),
            ),
          )
          .limit(1);
        if (row) {
          await db.delete(projectUpvotesTable).where(eq(projectUpvotesTable.id, row.id));
          upvoted = false;
        } else {
          upvoted = false;
        }
      } else {
        throw err;
      }
    }
  }

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int`.mapWith(Number) })
    .from(projectUpvotesTable)
    .where(eq(projectUpvotesTable.project_id, projectId));
  const count = Number(countRow?.count ?? 0);

  if (firedNotification && project.user_id) {
    // Upvote rows are deleted on un-upvote, so the permanent notifications table is the dedup ledger.
    const dedupEntityId = `${project.id}:${user.id}`;
    const [prior] = await db
      .select({ id: notificationTable.id })
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.user_id, project.user_id),
          eq(notificationTable.type, "project_upvoted"),
          eq(notificationTable.entity_type, "project_upvote"),
          eq(notificationTable.entity_id, dedupEntityId),
        ),
      )
      .limit(1);
    if (!prior) {
      void notify({
        user_id: project.user_id,
        type: "project_upvoted",
        title: "Someone upvoted your project",
        body: `${getDisplayName(user)} upvoted ${project.name}`,
        action_url: `/projects/${project.id}`,
        entity_type: "project_upvote",
        entity_id: dedupEntityId,
        skip_channels: ["slack", "email"],
      });
    }
  }

  // Only wakes clients; fresh data comes from REST endpoints that already gate on HCA and shadow ban.
  void publishEvent("explore", {
    type: "project_upvoted",
    project_id: project.id,
    upvoted,
    count,
  });

  return { upvoted, count };
});
