import { and, eq, inArray, or, sql } from "drizzle-orm";

import db from "../db";
import { shipContributorsTable, shipTable, users } from "../db/schema";

// Staff test accounts skip the shipped gate for end-to-end testing; is_system is only settable by a direct DB write.
export async function isStaffTestAccount(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isSystem: users.is_system })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.isSystem === true;
}

// Collaborators have no ships row of their own, so ship_contributors counts too.
// The status filter matches the NPS endpoint so "shipped" means the same everywhere.
export async function userHasShippedProject(userId: string): Promise<boolean> {
  if (await isStaffTestAccount(userId)) return true;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(shipTable)
    .leftJoin(
      shipContributorsTable,
      eq(shipContributorsTable.ship_id, shipTable.id),
    )
    .where(
      and(
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        or(
          eq(shipTable.user_id, userId),
          eq(shipContributorsTable.user_id, userId),
        ),
      ),
    );
  return Number(row?.count ?? 0) > 0;
}

// DISTINCT so multi-contributor ships count once; counts ships, not projects, to match the NPS gate.
export async function countShippedShipsForUser(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${shipTable.id})::int` })
    .from(shipTable)
    .leftJoin(
      shipContributorsTable,
      eq(shipContributorsTable.ship_id, shipTable.id),
    )
    .where(
      and(
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        or(
          eq(shipTable.user_id, userId),
          eq(shipContributorsTable.user_id, userId),
        ),
      ),
    );
  return Number(row?.count ?? 0);
}
