import { sql } from "drizzle-orm";
import db from "../../db";
import { getSession } from "../../lib/session";

// Users without linked HCA (sub IS NULL) aren't publicly profiled. Projects match
// the explore feed shape so ProjectExploreCard can render them.

export default defineEventHandler(async (event) => {
  const viewer = await getSession(event);
  const param = getRouterParam(event, "username");
  if (!param || typeof param !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Missing username" });
  }

  // PII guard: never select users.name or users.country.
  const [user] = await db.execute<{
    id: string;
    username: string | null;
    image: string | null;
    slack_id: string | null;
    created_at: Date | null;
    last_active_date: string | null;
  }>(sql`
    SELECT id, username, image, slack_id, created_at, last_active_date
    FROM users
    WHERE sub IS NOT NULL
      AND (LOWER(username) = LOWER(${param}) OR id = ${param})
    ORDER BY (id = ${param}) DESC, (username = ${param}) DESC, created_at ASC
    LIMIT 1
  `);
  // Usernames aren't unique; the ORDER BY must match og.get.ts so a /u/<name> link
  // and its preview card resolve to the same person.

  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const viewerId = viewer?.id ?? null;

  // Includes active collaborations; the owner is joined so cards credit the real owner.
  const projects = (await db.execute<{
    id: number;
    name: string;
    description: string | null;
    type: "software" | "hardware";
    fruit: string | null;
    level: string | null;
    thumbnail_url: string | null;
    project_streak_days: number;
    last_worked_date: string | null;
    created_at: Date | null;
    updated_at: Date | null;
    upvote_count: number;
    current_user_upvoted: boolean;
    has_shipped: boolean;
    owner_id: string;
    owner_image: string | null;
    owner_username: string | null;
    owner_slack_id: string | null;
    owner_created_at: Date | null;
  }>(sql`
    SELECT
      p.id,
      p.name,
      p.description,
      p.type,
      p.fruit,
      p.level,
      p.thumbnail_url,
      p.project_streak_days,
      p.last_worked_date,
      p.created_at,
      p.updated_at,
      COALESCE(uv.cnt, 0)::int AS upvote_count,
      ${viewerId
        ? sql`EXISTS (SELECT 1 FROM project_upvotes me WHERE me.project_id = p.id AND me.user_id = ${viewerId})`
        : sql`false`} AS current_user_upvoted,
      EXISTS (SELECT 1 FROM ships s WHERE s.project_id = p.id AND s.status IN ('shipped', 'shipped_missing_airtable')) AS has_shipped,
      u.id AS owner_id,
      u.image AS owner_image,
      u.username AS owner_username,
      u.slack_id AS owner_slack_id,
      u.created_at AS owner_created_at
    FROM projects p
    INNER JOIN users u ON u.id = p.user_id
    LEFT JOIN (
      SELECT project_id, COUNT(*) AS cnt
      FROM project_upvotes
      GROUP BY project_id
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
    ORDER BY p.project_streak_days DESC, p.updated_at DESC NULLS LAST, p.id DESC
  `)).map((r) => ({
    id: Number(r.id),
    name: r.name,
    description: r.description,
    type: r.type,
    fruit: r.fruit,
    level: r.level,
    thumbnail_url: r.thumbnail_url,
    project_streak_days: Number(r.project_streak_days ?? 0),
    last_worked_date: r.last_worked_date,
    created_at: r.created_at,
    updated_at: r.updated_at,
    upvote_count: Number(r.upvote_count ?? 0),
    current_user_upvoted: Boolean(r.current_user_upvoted),
    has_shipped: Boolean(r.has_shipped),
    owner: {
      id: r.owner_id,
      image: r.owner_image,
      username: r.owner_username,
      slack_id: r.owner_slack_id,
      created_at: r.owner_created_at,
    },
  }));

  return {
    id: user.id,
    username: user.username,
    image: user.image,
    slack_id: user.slack_id,
    created_at: user.created_at,
    last_active_date: user.last_active_date,
    project_count: projects.length,
    total_upvotes: projects.reduce((acc, p) => acc + p.upvote_count, 0),
    top_streak_days: projects.reduce(
      (acc, p) => Math.max(acc, p.project_streak_days),
      0,
    ),
    projects,
  };
});
