import { eq } from "drizzle-orm";

import db from "../db";
import { journalsTable } from "../db/schema";

export type ReviewPhaseId = "journals" | "evidence" | "summary";

export function shipHasLinkedHackatimeProjects(
  ship: { hackatime_projects: string[] | null | undefined },
): boolean {
  return Array.isArray(ship.hackatime_projects) && ship.hackatime_projects.length > 0;
}

export function getReviewFlow(
  projectType: "software" | "hardware" | null | undefined,
  options?: { hasHackatimeProjects?: boolean },
) {
  const hasHardware = projectType === "hardware";

  // Hardware ships get the software review surface only when they link a hackatime project.
  const hasSoftware =
    projectType === "software" || (hasHardware && options?.hasHackatimeProjects === true);
  const numberedPhaseOrder: Array<Exclude<ReviewPhaseId, "summary">> = [];

  // Must match the review page's tab order so the "N/N" step badges read in sequence.
  if (hasSoftware) {
    numberedPhaseOrder.push("evidence");
  }

  if (hasHardware) {
    numberedPhaseOrder.push("journals");
  }

  return {
    hasHardware,
    hasSoftware,
    numberedPhaseOrder,
    phaseOrder: [...numberedPhaseOrder, "summary"] as ReviewPhaseId[],
  };
}

export async function getJournalHoursBreakdownForShip(shipId: number) {
  const linkedJournals = await db
    .select({
      hours: journalsTable.hours,
      override_hours: journalsTable.override_hours,
      approved: journalsTable.approved,
      reviewed: journalsTable.reviewed,
      archived: journalsTable.archived,
    })
    .from(journalsTable)
    .where(eq(journalsTable.linked_ship, shipId));

  // Archived journals never count, even if approved before archiving.
  // rawHours is the claimed total; approvedHours is the credited total after deflation.
  let rawHours = 0;
  let approvedHours = 0;
  let journalCount = 0;
  for (const journal of linkedJournals) {
    if (journal.archived) {
      continue;
    }
    journalCount += 1;
    rawHours += journal.hours ?? 0;
    if (journal.reviewed && journal.approved) {
      approvedHours += journal.override_hours ?? journal.hours ?? 0;
    }
  }

  return { rawHours, approvedHours, journalCount };
}

export async function getApprovedJournalHoursForShip(shipId: number) {
  const { approvedHours } = await getJournalHoursBreakdownForShip(shipId);
  return approvedHours;
}
