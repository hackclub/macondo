// Snapshots freeze each day's DAU, since hackatime syncs keep rewriting past daily_project_activity rows.

import { sql } from "drizzle-orm";

import db from "../db";
import { dauSnapshotsTable } from "../db/schema";
import { getBannedUserIds } from "./hackatime";

type ActiveUserRow = { user_id: string };

// `day` is "YYYY-MM-DD" in EST, matching the rest of the stats pipeline.
export async function captureDauSnapshot(day: string): Promise<number> {
  const rows = (await db.execute(sql`
    SELECT DISTINCT user_id
    FROM daily_project_activity
    WHERE day = ${day}
      AND (journal_seconds + hackatime_seconds) >= 300
  `)) as unknown as ActiveUserRow[];

  const userIds = rows.map((r) => r.user_id).filter((id): id is string => !!id);
  const bannedIds = userIds.length ? await getBannedUserIds(userIds) : new Set<string>();
  const count = userIds.filter((id) => !bannedIds.has(id)).length;

  await db
    .insert(dauSnapshotsTable)
    .values({ day, count })
    .onConflictDoUpdate({
      target: dauSnapshotsTable.day,
      set: {
        count: sql`EXCLUDED.count`,
        captured_at: sql`now()`,
      },
    });

  return count;
}

export function yesterdayInEst(): string {
  const estNow = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  estNow.setDate(estNow.getDate() - 1);
  return `${estNow.getFullYear()}-${String(estNow.getMonth() + 1).padStart(2, "0")}-${String(estNow.getDate()).padStart(2, "0")}`;
}

export async function captureYesterdayDauSnapshot(): Promise<{
  day: string;
  count: number;
}> {
  const day = yesterdayInEst();
  return { day, count: await captureDauSnapshot(day) };
}
