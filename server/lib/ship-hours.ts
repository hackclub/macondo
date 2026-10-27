import { and, eq, sql } from "drizzle-orm";

import db from "../db";
import { journalsTable, shipContributorsTable, shipTable, users } from "../db/schema";
import { cached } from "./cache";
import { getAuthenticatedProjects } from "./hackatime";
import { MACONDO_HOURS_START_DATE } from "./streaks";

export type ContributorHours = {
  // Only names the member actually has hours on appear here.
  breakdown: Record<string, number>;
  total: number;
  // false on a missing token or API failure: fall back to the stored snapshot rather than trust a 0.
  tokenOk: boolean;
};

export type ShipContributorHours = {
  perUser: Map<string, ContributorHours>;
  total: number;
};

// JSON-serializable shape the cache layer can round-trip (a Map cannot).
type CachedShipContributorHours = {
  contributors: Array<{ user_id: string } & ContributorHours>;
  total: number;
};

/**
 * Uses each member's own OAuth token. Supersedes ship_contributors.hackatime_hours,
 * which is 0 for collaborators because submit only fetches the owner's token.
 */
export async function getShipContributorHours(
  shipId: number,
): Promise<ShipContributorHours> {
  const cachedResult = await cached<CachedShipContributorHours>(
    `ship:contributor-hours:${shipId}`,
    30, // cache ttl in seconds
    async () => {
      const [ship] = await db
        .select({ hackatime_projects: shipTable.hackatime_projects })
        .from(shipTable)
        .where(eq(shipTable.id, shipId))
        .limit(1);

      const linkedNames = ship?.hackatime_projects ?? [];

      const rows = await db
        .select({
          user_id: shipContributorsTable.user_id,
          hackatime_oauth_token: users.hackatime_oauth_token,
        })
        .from(shipContributorsTable)
        .leftJoin(users, eq(users.id, shipContributorsTable.user_id))
        .where(eq(shipContributorsTable.ship_id, shipId));

      if (linkedNames.length === 0) {
        return {
          contributors: rows.map((row) => ({
            user_id: row.user_id,
            breakdown: {},
            total: 0,
            tokenOk: false,
          })),
          total: 0,
        };
      }

      const contributors = await Promise.all(
        rows.map(async (row) => {
          const token = row.hackatime_oauth_token ?? null;
          const breakdown: Record<string, number> = {};
          let tokenOk = false;
          if (token) {
            try {
              const projects = await getAuthenticatedProjects(token, {
                startDate: MACONDO_HOURS_START_DATE,
              });
              if (projects) {
                tokenOk = true;
                for (const name of linkedNames) {
                  const match = projects.projects.find((h) => h.name === name);
                  if (match) breakdown[name] = match.total_seconds / 3600; // seconds to hours
                }
              }
            } catch {
              tokenOk = false;
            }
          }
          return {
            user_id: row.user_id,
            breakdown,
            total: Object.values(breakdown).reduce((a, b) => a + b, 0),
            tokenOk,
          };
        }),
      );

      return { contributors, total: contributors.reduce((sum, c) => sum + c.total, 0) };
    },
  );

  const perUser = new Map<string, ContributorHours>();
  for (const c of cachedResult.contributors) {
    perUser.set(c.user_id, {
      breakdown: c.breakdown,
      total: c.total,
      tokenOk: c.tokenOk,
    });
  }
  return { perUser, total: cachedResult.total };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ContributorClaimedHours =
  // Null on a solo ship: there is nothing to split.
  // approved_hours is the member's total (hackatime + journals), named for buildApproveSnapshot.
  | {
      ok: true;
      hours: Array<{
        user_id: string;
        approved_hours: number;
        hackatime: number;
        journals: number;
      }> | null;
    }
  // Members whose Hackatime couldn't be read; splitting now would pay them as if they had none.
  | { ok: false; unreadable: string[] };

/**
 * What each member of a group ship claims: their own Hackatime time on the ship's linked projects
 * plus their own journals. The weights for the gold split when no reviewer set per-member hours.
 */
export async function getContributorClaimedHours(ship: {
  id: number;
  hackatime_projects: string[] | null;
}): Promise<ContributorClaimedHours> {
  const members = await db
    .select({
      user_id: shipContributorsTable.user_id,
      has_token: sql<boolean>`${users.hackatime_oauth_token} IS NOT NULL`,
    })
    .from(shipContributorsTable)
    .leftJoin(users, eq(users.id, shipContributorsTable.user_id))
    .where(eq(shipContributorsTable.ship_id, ship.id));
  if (members.length <= 1) return { ok: true, hours: null };

  // Unlinking a journal archives it, so archived ones don't count.
  const journalRows = await db
    .select({
      user_id: journalsTable.user_id,
      hours: sql<number>`COALESCE(SUM(${journalsTable.hours}), 0)::float8`,
    })
    .from(journalsTable)
    .where(and(eq(journalsTable.linked_ship, ship.id), eq(journalsTable.archived, false)))
    .groupBy(journalsTable.user_id);
  const journalHours = new Map(journalRows.map((r) => [r.user_id, Number(r.hours)]));

  const hasHackatime = (ship.hackatime_projects ?? []).length > 0;
  const live = hasHackatime ? await getShipContributorHours(ship.id) : null;
  // A member who never connected Hackatime has no tracked time; a connected one we can't read is unknown.
  const unreadable = live
    ? members
        .filter((m) => m.has_token && !live.perUser.get(m.user_id)?.tokenOk)
        .map((m) => m.user_id)
    : [];
  if (unreadable.length > 0) return { ok: false, unreadable };

  return {
    ok: true,
    hours: members.map((m) => {
      const hackatime = round2(live?.perUser.get(m.user_id)?.total ?? 0);
      const journals = round2(journalHours.get(m.user_id) ?? 0);
      return { user_id: m.user_id, approved_hours: round2(hackatime + journals), hackatime, journals };
    }),
  };
}
