import { sql } from "drizzle-orm";
import db from "../../db";

const VALID_SORTS = new Set(["popularity", "newest", "recently_active", "streak"]);

function clampLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(Math.floor(n), 60);
}

function parseOffset(raw: unknown): number {
  if (raw == null || raw === "") return 0;
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function pickString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default defineEventHandler(async (event) => {
  const q = getQuery(event);

  const sortRaw = pickString(q.sort) ?? "recently_active";
  const sort = VALID_SORTS.has(sortRaw) ? sortRaw : "recently_active";
  const search = pickString(q.search);
  const country = pickString(q.country);
  const offset = parseOffset(q.cursor);
  const limit = clampLimit(q.limit);

  const conditions = [
    // sub, not hca_verification_status, which is null for legacy linked-HCA users.
    sql`u.sub IS NOT NULL`,
    sql`u.is_temp = false`,
    // Machine actors and staff test accounts, see schema.ts is_system.
    sql`u.is_system = false`,
    sql`u.onboarding_step IS DISTINCT FROM 'welcome'`,
  ];
  // Country filter intentionally dropped: users.country is PII, so filtering on it would leak it.
  if (country && country.length === 2) {
    // ignore the param to keep the API contract stable for old clients
  }
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    // Search restricted to username; legal name is server-side only.
    conditions.push(sql`u.username ILIKE ${like}`);
  }

  const orderBy =
    sort === "popularity"
      ? sql`COALESCE(stats.total_upvotes, 0) DESC, u.last_active_date DESC NULLS LAST, u.id ASC`
      : sort === "newest"
        ? sql`u.created_at DESC NULLS LAST, u.id ASC`
        : sort === "streak"
          ? sql`COALESCE(stats.top_streak_days, 0) DESC, u.last_active_date DESC NULLS LAST, u.id ASC`
          : sql`u.last_active_date DESC NULLS LAST, u.created_at DESC NULLS LAST, u.id ASC`;

  // PII guard: never SELECT name or country here.
  const rows = await db.execute<{
    id: string;
    username: string | null;
    image: string | null;
    slack_id: string | null;
    last_active_date: string | null;
    created_at: Date | null;
    project_count: number;
    total_upvotes: number;
    top_streak_days: number;
  }>(sql`
    SELECT
      u.id,
      u.username,
      u.image,
      u.slack_id,
      u.last_active_date,
      u.created_at,
      COALESCE(stats.project_count, 0)::int AS project_count,
      COALESCE(stats.total_upvotes, 0)::int AS total_upvotes,
      COALESCE(stats.top_streak_days, 0)::int AS top_streak_days
    FROM users u
    LEFT JOIN (
      SELECT
        p.user_id,
        COUNT(DISTINCT p.id) AS project_count,
        COALESCE(SUM(uv.cnt), 0) AS total_upvotes,
        COALESCE(MAX(p.project_streak_days), 0) AS top_streak_days
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) AS cnt
        FROM project_upvotes
        GROUP BY project_id
      ) uv ON uv.project_id = p.id
      WHERE p.deleted_at IS NULL
        AND EXISTS (
        SELECT 1 FROM journals j WHERE j.project_id = p.id AND j.archived = false
      )
      GROUP BY p.user_id
    ) stats ON stats.user_id = u.id
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY ${orderBy}
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `);

  const all = rows.map((r) => ({
    id: r.id,
    username: r.username,
    image: r.image,
    slack_id: r.slack_id,
    last_active_date: r.last_active_date,
    created_at: r.created_at,
    project_count: Number(r.project_count ?? 0),
    total_upvotes: Number(r.total_upvotes ?? 0),
    top_streak_days: Number(r.top_streak_days ?? 0),
  }));

  const hasMore = all.length > limit;
  const items = hasMore ? all.slice(0, limit) : all;

  // Same SWR policy as /api/explore/projects.
  setHeader(event, "Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");

  return { items, next_cursor: hasMore ? offset + items.length : null };
});
