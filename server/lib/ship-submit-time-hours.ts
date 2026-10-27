// "New work" baseline: hours logged at submit, from heartbeats (120s gap rule), cached forever since past heartbeats never change.
// Ship-row clamps apply on read because software_override_hours is mutable; any failure falls back to credited hours.

import { asc, eq } from "drizzle-orm";

import { useRuntimeConfig } from "#imports";

import db from "../db";
import { projectTable, shipTable, users } from "../db/schema";
import { getRedis } from "./redis";
import { mergedGapSumSeconds } from "./streak-helpers";
import { MACONDO_HOURS_START_DATE } from "./streaks";
import {
  TUTORIAL_BONUS_HOURS,
  clampSubmitTimeHours,
  creditedHackatimeHours,
  loggedSubmitTimeHours,
} from "./tutorial-bonus";
import { HACKATIME_ADMIN_API_URL } from "./api-urls";

const HEARTBEAT_BATCH_SIZE = 5000;
// Bump the version when the cached math changes; v1 and v2 values must not be reused.
const CACHE_KEY_PREFIX = "ship:submitTimeHackatime:v3:";

type ShipShape = {
  id: number;
  user_id: string;
  project_id: number;
  hackatime_projects: string[] | null;
  hackatime_hours: number | null;
  software_override_hours?: number | null;
  created_at: Date | null;
};

type Heartbeat = {
  time: number;
  project: string | null;
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function fetchHeartbeats(
  adminKey: string,
  hackatimeId: number,
  startSeconds: number,
  endSeconds: number,
): Promise<Heartbeat[]> {
  const out: Heartbeat[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore && out.length < 50000) { // max heartbeats fetched per ship
    const res = await fetch(
      `${HACKATIME_ADMIN_API_URL}/user/heartbeats` +
        `?id=${hackatimeId}` +
        `&start_date=${startSeconds}` +
        `&end_date=${endSeconds}` +
        `&limit=${HEARTBEAT_BATCH_SIZE}` +
        `&offset=${offset}`,
      {
        headers: {
          Authorization: `Bearer ${adminKey}`,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) {
      throw new Error(
        `hackatime admin returned ${res.status} ${res.statusText} for hackatime_id=${hackatimeId}`,
      );
    }
    const data = (await res.json()) as {
      heartbeats?: Heartbeat[];
      has_more?: boolean;
    };
    out.push(...(data.heartbeats ?? []));
    hasMore = data.has_more === true;
    offset += HEARTBEAT_BATCH_SIZE;
  }
  return out;
}

// Hackatime's own duration rule keeps the baseline on the same scale as ship.hackatime_hours.
function durationSecondsForProjects(
  beats: Heartbeat[],
  projects: Set<string>,
): number {
  return mergedGapSumSeconds(
    beats.filter((b) => b.project != null && projects.has(b.project)),
  );
}

/** Falls back to creditedHackatimeHours on any failure, so callers need no try/catch. */
export async function getShipSubmitTimeHackatimeHours(
  ship: ShipShape,
): Promise<number> {
  const credited = creditedHackatimeHours(ship);

  // Applied on every read, never stored, because both bounds read mutable ship columns.
  const clampToShip = (raw: number) => clampSubmitTimeHours(raw, ship);

  if (!ship.created_at) return credited;
  const linked = Array.from(new Set(ship.hackatime_projects ?? []));
  if (linked.length === 0) return credited;

  const config = useRuntimeConfig();
  const adminKey = (config.hackatimeAdminKey as string | undefined) ?? null;
  if (!adminKey) return credited;

  const cacheKey = `${CACHE_KEY_PREFIX}${ship.id}`;
  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached != null) {
        const parsed = Number(cached);
        if (Number.isFinite(parsed)) return clampToShip(parsed);
      }
    } catch (err) {
      console.warn(
        `[ship-submit-time-hours] redis read failed for ship=${ship.id}`,
        err,
      );
    }
  }

  try {
    const [owner] = await db
      .select({ hackatime_id: users.hackatime_id })
      .from(users)
      .where(eq(users.id, ship.user_id))
      .limit(1);
    if (!owner?.hackatime_id) return credited;

    // Same start floor as everywhere else so pre-program heartbeats never count.
    const startSeconds = Math.floor(
      new Date(`${MACONDO_HOURS_START_DATE}T00:00:00.000Z`).getTime() / 1000, // ms to unix seconds
    );
    const endSeconds = Math.floor(ship.created_at.getTime() / 1000);
    if (endSeconds <= startSeconds) {
      // Submitted before the program window: 0 real hours, and clampToShip still floors at credited.
      if (redis) {
        await redis
          .set(cacheKey, "0")
          .catch((err) =>
            console.warn(
              `[ship-submit-time-hours] redis write failed for ship=${ship.id}`,
              err,
            ),
          );
      }
      return clampToShip(0);
    }

    const totalSeconds = durationSecondsForProjects(
      await fetchHeartbeats(adminKey, owner.hackatime_id, startSeconds, endSeconds),
      new Set(linked),
    );
    const realHours = r2(totalSeconds / 3600); // seconds to hours

    // A guide project's earliest ship bundles +1h into hackatime_hours, so the baseline
    // must too or the delta would over-credit by 1h.
    const [proj] = await db
      .select({ guide: projectTable.guide })
      .from(projectTable)
      .where(eq(projectTable.id, ship.project_id))
      .limit(1);
    let earliestShipId: number | null = null;
    if (proj?.guide) {
      const [earliest] = await db
        .select({ id: shipTable.id })
        .from(shipTable)
        .where(eq(shipTable.project_id, ship.project_id))
        .orderBy(asc(shipTable.id))
        .limit(1);
      earliestShipId = earliest?.id ?? null;
    }
    // Only the html tutorial earns the bonus; other guides are real projects.
    const hours = r2(
      realHours +
        (proj?.guide === "html" && earliestShipId === ship.id ? TUTORIAL_BONUS_HOURS : 0),
    );

    if (redis) {
      await redis
        .set(cacheKey, String(hours))
        .catch((err) =>
          console.warn(
            `[ship-submit-time-hours] redis write failed for ship=${ship.id}`,
            err,
          ),
        );
    }
    return clampToShip(hours);
  } catch (err) {
    console.error(
      `[ship-submit-time-hours] compute failed for ship=${ship.id}, falling back to credited`,
      err,
    );
    return credited;
  }
}

/**
 * Strips the credited floor back to what the submitter logged, since credits can include journals or team totals.
 * Use for payable or reviewer-facing deltas; the raw function suits the fraud-review threshold.
 */
export async function getPreviousShipDeltaBaseline(
  previousShip: ShipShape,
): Promise<number> {
  return loggedSubmitTimeHours(
    await getShipSubmitTimeHackatimeHours(previousShip),
    previousShip,
  );
}
