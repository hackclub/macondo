import { and, desc, eq, inArray } from "drizzle-orm";

import db from "../db";
import { projectGrantTable } from "../db/schema";

export type ProjectGrantRow = typeof projectGrantTable.$inferSelect;

export type ProjectGrantHistory = {
  hasPriorActiveGrant: boolean;
  latestActiveGrant: ProjectGrantRow | null;
};

// Cancelled grants don't count, so a project whose only grant was cancelled is still on its first.
// `excludeShipId` skips a ship's own linked grant when re-evaluating it (e.g. resubmits).
export async function getProjectGrantHistory(
  projectId: number,
  options: { excludeShipId?: number } = {},
): Promise<ProjectGrantHistory> {
  const rows = await db
    .select()
    .from(projectGrantTable)
    .where(
      and(
        eq(projectGrantTable.project_id, projectId),
        inArray(projectGrantTable.status, ["queued", "sent"]),
      ),
    )
    .orderBy(desc(projectGrantTable.created_at), desc(projectGrantTable.id));

  const filtered =
    options.excludeShipId !== undefined
      ? rows.filter((row) => row.ship_id !== options.excludeShipId)
      : rows;

  return {
    hasPriorActiveGrant: filtered.length > 0,
    latestActiveGrant: filtered[0] ?? null,
  };
}

// Round up to the nearest $10 (1000 cents) as a buffer for tax, shipping and price changes.
export function roundUpHardwareGrantCents(cents: number | null | undefined): number {
  const n = cents ?? 0;
  if (n <= 0) return 0;
  return Math.ceil(n / 1000) * 1000;
}
