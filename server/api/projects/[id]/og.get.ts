import { sql } from "drizzle-orm";
import db from "~~/server/db";
import { getPublicProjectTotalHours } from "~~/server/lib/project-hours";

// Separate from /api/projects/[id] to skip the slow Hackatime call, so link unfurlers stay cheap.

type Row = {
  name: string;
  type: "software" | "hardware";
  thumbnail_url: string | null;
  owner_name: string | null;
  owner_image: string | null;
};

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, "id"));
  if (!id || isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  // Parallel because unfurlers are latency-sensitive.
  const [[row], totalHours] = await Promise.all([
    db.execute<Row>(sql`
      SELECT
        p.name,
        p.type,
        p.thumbnail_url,
        u.username AS owner_name,
        u.image AS owner_image
      FROM projects p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id = ${id}
        AND p.deleted_at IS NULL
      LIMIT 1
    `),
    getPublicProjectTotalHours(id),
  ]);

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  const thumbnailUrl = row.thumbnail_url || null;

  return {
    name: row.name,
    ownerName: row.owner_name,
    ownerImage: row.owner_image || null,
    type: row.type,
    hours: Math.round(totalHours),
    hasThumbnail: !!thumbnailUrl,
    thumbnailUrl,
  };
});
