import { sql } from "drizzle-orm";
import db from "~~/server/db";

export default defineEventHandler(async (event) => {
  const param = getRouterParam(event, "username");
  if (!param || typeof param !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Missing username" });
  }

  // PII guard: only username + avatar.
  const [user] = await db.execute<{
    id: string;
    username: string | null;
    image: string | null;
  }>(sql`
    SELECT id, username, image
    FROM users
    WHERE sub IS NOT NULL
      AND (LOWER(username) = LOWER(${param}) OR id = ${param})
    ORDER BY (id = ${param}) DESC, (username = ${param}) DESC, created_at ASC
    LIMIT 1
  `);
  // ORDER BY must match [username].get.ts so ambiguous usernames resolve to the same user.

  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const [stats] = await db.execute<{
    project_count: number | string;
    total_upvotes: number | string;
    top_streak_days: number | string;
  }>(sql`
    SELECT
      COUNT(*)::int AS project_count,
      COALESCE(SUM(uv.cnt), 0)::int AS total_upvotes,
      COALESCE(MAX(p.project_streak_days), 0)::int AS top_streak_days
    FROM projects p
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS cnt FROM project_upvotes GROUP BY project_id
    ) uv ON uv.project_id = p.id
    WHERE (
        p.user_id = ${user.id}
        OR EXISTS (
          SELECT 1 FROM project_collaborators pc
          WHERE pc.project_id = p.id
            AND pc.user_id = ${user.id}
            AND pc.status = 'active'
        )
      )
      AND p.deleted_at IS NULL
  `);

  return {
    username: user.username,
    image: user.image,
    projectCount: Number(stats?.project_count ?? 0),
    topStreakDays: Number(stats?.top_streak_days ?? 0),
    totalUpvotes: Number(stats?.total_upvotes ?? 0),
  };
});
