import { sql } from "drizzle-orm";

import db from "../../db";
import { getSession } from "../../lib/session";

// starts_at is a tz-naive UTC instant, so compare against an ISO string cast to timestamp;
// binding a JS Date into the template would crash postgres-js.

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

export default defineEventHandler(async (event) => {
  const user = await getSession(event);
  const q = getQuery(event);
  const offset = parseOffset(q.cursor);
  const limit = clampLimit(q.limit);
  const viewerId = user?.id ?? null;

  const rows = await db.execute<{
    id: number;
    title: string;
    description: string | null;
    image_url: string | null;
    rsvp_url: string | null;
    starts_at: Date | null;
    ends_at: Date | null;
    timezone: string | null;
    attendee_count: number;
    rsvp_status: string | null;
  }>(sql`
    SELECT
      e.id,
      e.title,
      e.description,
      e.image_url,
      e.rsvp_url,
      e.starts_at,
      e.ends_at,
      e.timezone,
      COALESCE(ac.cnt, 0)::int AS attendee_count,
      ${viewerId
        ? sql`(SELECT me.rsvp_status FROM event_attendees me WHERE me.event_id = e.id AND me.user_id = ${viewerId} LIMIT 1)`
        : sql`NULL`} AS rsvp_status
    FROM events e
    LEFT JOIN (
      SELECT event_id, COUNT(*) FILTER (WHERE rsvp_status = 'interested') AS cnt
      FROM event_attendees
      GROUP BY event_id
    ) ac ON ac.event_id = e.id
    WHERE e.status = 'published'
      AND (e.starts_at IS NULL OR e.starts_at >= ${new Date().toISOString()}::timestamp)
    ORDER BY e.starts_at ASC NULLS LAST, e.id DESC
    LIMIT ${limit + 1}
    OFFSET ${offset}
  `);

  const all = rows.map((r) => ({
    id: Number(r.id),
    title: r.title,
    description: r.description,
    image_url: r.image_url,
    rsvp_url: r.rsvp_url,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    timezone: r.timezone,
    attendee_count: Number(r.attendee_count ?? 0),
    rsvp_status: r.rsvp_status,
  }));

  const hasMore = all.length > limit;
  const items = hasMore ? all.slice(0, limit) : all;

  // Public, mildly cacheable; rsvp_status refreshes on the next refetch.
  setHeader(event, "Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=120");

  return { items, next_cursor: hasMore ? offset + items.length : null };
});
