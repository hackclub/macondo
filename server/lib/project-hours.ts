import { sql } from "drizzle-orm";
import db from "../db";

// ships.hackatime_hours is cumulative per ship, so MAX (not SUM) avoids double-
// counting re-ships. It only covers the owner; collaborators count via journals.
export async function getPublicProjectTotalHours(
  projectId: number,
): Promise<number> {
  const [row] = await db.execute<{
    journal_hours: string | number | null;
    ship_hours: string | number | null;
  }>(sql`
    SELECT
      COALESCE((
        SELECT SUM(COALESCE(j.override_hours, j.hours, 0))
        FROM journals j
        WHERE j.project_id = ${projectId} AND j.archived = false
      ), 0) AS journal_hours,
      COALESCE((
        SELECT MAX(s.hackatime_hours)
        FROM ships s
        WHERE s.project_id = ${projectId}
      ), 0) AS ship_hours
  `);
  return Math.max(
    Number(row?.journal_hours ?? 0),
    Number(row?.ship_hours ?? 0),
  );
}
