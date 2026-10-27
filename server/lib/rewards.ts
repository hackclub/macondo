import { and, desc, eq, ne, or } from "drizzle-orm";

import db from "../db";
import { shipTable } from "../db/schema";

import type { ProjectLevel } from "../../app/data/fruitLevels";
import { levelConfig } from "../../app/data/fruitLevels";

// Re-exported for existing ./rewards imports; tutorial-bonus.ts stays free of #imports for unit tests.
export {
  TUTORIAL_BONUS_HOURS,
  computeTutorialBonusHours,
  realHackatimeHours,
  computeHackatimeDeltaWithBonus,
  creditedHackatimeHours,
} from "./tutorial-bonus";

type ShipRow = typeof shipTable.$inferSelect;

export async function getPreviousShippedShip(
  projectId: number,
  excludeShipId: number,
): Promise<Pick<
  ShipRow,
  | "id"
  | "user_id"
  | "project_id"
  | "hackatime_projects"
  | "hackatime_hours"
  | "software_override_hours"
  | "override_hours"
  | "created_at"
  | "reviewed_at"
> | null> {
  // user_id / project_id / hackatime_projects let callers pass the row straight to getShipSubmitTimeHackatimeHours.
  const [previous] = await db
    .select({
      id: shipTable.id,
      user_id: shipTable.user_id,
      project_id: shipTable.project_id,
      hackatime_projects: shipTable.hackatime_projects,
      hackatime_hours: shipTable.hackatime_hours,
      software_override_hours: shipTable.software_override_hours,
      override_hours: shipTable.override_hours,
      created_at: shipTable.created_at,
      reviewed_at: shipTable.reviewed_at,
    })
    .from(shipTable)
    .where(
      and(
        eq(shipTable.project_id, projectId),
        ne(shipTable.id, excludeShipId),
        or(
          eq(shipTable.status, "shipped"),
          eq(shipTable.status, "shipped_missing_airtable"),
        ),
      ),
    )
    .orderBy(desc(shipTable.created_at))
    .limit(1);

  return previous ?? null;
}

export function computeFruitReward(approvedHours: number, level: ProjectLevel): number {
  const config = levelConfig[level];
  if (!config) return 0;
  return approvedHours * config.nPerHour;
}

/** The caller applies the streak multiplier and floors to a whole gold coin. */
export function computeGoldReward(approvedHours: number, level: ProjectLevel): number {
  const config = levelConfig[level];
  if (!config) return 0;
  return approvedHours * config.goldPerHour;
}

/**
 * 10 gold = $1, so funded hours = amountCents / (10 * goldPerHour).
 * Callers clamp at approval time so funded hours never exceed approved hours.
 */
export function computeFundedHoursFromGrant(amountCents: number, level: ProjectLevel): number {
  const config = levelConfig[level];
  if (!config || config.goldPerHour <= 0) return 0;
  if (amountCents <= 0) return 0;
  return Math.round(amountCents / (10 * config.goldPerHour));
}

export function parseLevel(level: string | null): ProjectLevel | null {
  if (!level) return null;
  const num = Number(level);
  if (num >= 1 && num <= 4) return num as ProjectLevel;
  return null;
}
