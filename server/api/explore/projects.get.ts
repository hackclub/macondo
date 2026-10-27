import { sql } from "drizzle-orm";
import db from "../../db";
import { getSession } from "../../lib/session";

const VALID_SORTS = new Set(["popularity", "newest", "recently_updated", "streak"]);
const VALID_TYPES = new Set(["software", "hardware"]);
const VALID_LEVELS = new Set(["1", "2", "3", "4"]);
const VALID_STATUSES = new Set(["shipped", "in_progress", "all"]);

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
  const user = await getSession(event);
  const q = getQuery(event);

  const sortRaw = pickString(q.sort) ?? "recently_updated";
  const sort = VALID_SORTS.has(sortRaw) ? sortRaw : "recently_updated";
  const typeFilter = pickString(q.type);
  const type = typeFilter && VALID_TYPES.has(typeFilter) ? typeFilter : null;
  const fruit = pickString(q.fruit);
  const levelRaw = pickString(q.level);
  const level = levelRaw && VALID_LEVELS.has(levelRaw) ? levelRaw : null;
  const search = pickString(q.search);
  const statusRaw = pickString(q.status);
  const status = statusRaw && VALID_STATUSES.has(statusRaw) ? statusRaw : "shipped";
  const offset = parseOffset(q.cursor);
  const limit = clampLimit(q.limit);

  const conditions = [
    sql`p.deleted_at IS NULL`,
    // sub, not hca_verification_status (null for legacy users). Applies during search too.
    sql`u.sub IS NOT NULL`,
    // Machine actors and staff test accounts, see schema.ts is_system.
    sql`u.is_system = false`,
  ];
  // Browse only: a name search skips this so a journal-less project is still findable.
  if (!search) {
    conditions.push(sql`EXISTS (SELECT 1 FROM journals j WHERE j.project_id = p.id AND j.archived = false)`);
  }
  if (type) conditions.push(sql`p.type = ${type}`);
  // "extra_fruity" is a sentinel; real fruit values are capitalized names, so it can't collide.
  if (fruit === "extra_fruity") {
    conditions.push(sql`EXISTS (SELECT 1 FROM ships s WHERE s.project_id = p.id AND s.extra_fruity = true AND s.status IN ('shipped', 'shipped_missing_airtable'))`);
  } else if (fruit) {
    conditions.push(sql`p.fruit = ${fruit}`);
  }
  if (level) conditions.push(sql`p.level = ${level}`);
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`p.name ILIKE ${like}`);
  }
  // Applied even during search so the visible status dropdown always matches the results.
  if (status === "shipped") {
    conditions.push(sql`EXISTS (SELECT 1 FROM ships s WHERE s.project_id = p.id AND s.status IN ('shipped', 'shipped_missing_airtable'))`);
  } else if (status === "in_progress") {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM ships s WHERE s.project_id = p.id AND s.status IN ('shipped', 'shipped_missing_airtable'))`);
  }

  // OFFSET pagination; the WS-driven refetch in explore.vue heals concurrent-write drift.
  const whereClause = sql.join(conditions, sql` AND `);

  const orderBy =
    sort === "popularity"
      ? sql`upvote_count DESC, p.updated_at DESC NULLS LAST, p.id DESC`
      : sort === "newest"
        ? sql`p.created_at DESC NULLS LAST, p.id DESC`
        : sort === "streak"
          ? sql`p.project_streak_days DESC, p.updated_at DESC NULLS LAST, p.id DESC`
          : sql`p.updated_at DESC NULLS LAST, p.id DESC`;

  const viewerId = user?.id ?? null;

  // PII guard: never SELECT users.name or users.country onto the wire.
  const rows = await db.execute<{
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
    is_extra_fruity: boolean;
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
      EXISTS (SELECT 1 FROM ships s WHERE s.project_id = p.id AND s.extra_fruity = true AND s.status IN ('shipped', 'shipped_missing_airtable')) AS is_extra_fruity,
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
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `);

  const all = rows.map((r) => ({
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
    is_extra_fruity: Boolean(r.is_extra_fruity),
    owner: {
      id: r.owner_id,
      image: r.owner_image,
      username: r.owner_username,
      slack_id: r.owner_slack_id,
      created_at: r.owner_created_at,
    },
  }));

  const hasMore = all.length > limit;
  const items = hasMore ? all.slice(0, limit) : all;

  // Anonymous-public, so CDN/browser caches absorb spikes; the upvote toggle refreshes on refetch.
  setHeader(event, "Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");

  return { items, next_cursor: hasMore ? offset + items.length : null };
});
