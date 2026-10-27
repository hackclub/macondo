import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import db from "../db";
import {
  hackatimeSyncAuditTable,
  projectTable,
  shipTable,
  users,
} from "../db/schema";
import {
  classifyHackatimeAuthFailure,
  getAuthenticatedHours,
  getAuthenticatedProjects,
  syncHackatimeTimezone,
} from "./hackatime";
import { TUTORIAL_BONUS_HOURS } from "./rewards";
import { MACONDO_HOURS_START_DATE, clearStreakCacheForUser, extendProjectStreaksFromHackatime, extendStreak, getActiveTeamProjectIdsForMember, getUserLinkedHackatimeSecondsToday, recomputeTeamProjectStreak, resetUserProjectStreaks } from "./streaks";
import { backfillUserActivity } from "./daily-activity";

const REVIEW_QUEUE_STATUSES = ["under_review", "pending_fraud_review", "pending_second_pass"] as const;

export type BatchSyncSource =
  | "manual"
  | "scheduled"
  | "startup"
  | "scheduled_active";

export type BatchSyncOutcome = {
  user_id: string;
  ok: boolean;
  reason?: string;
  delta_seconds?: number;
  extended?: number[];
  ships_resnapped?: number;
};

export type BatchSyncReport = {
  scanned: number;
  synced: number;
  failed: number;
  project_streaks_extended: number;
  ships_resnapshotted: number;
  failures: BatchSyncOutcome[];
  duration_ms: number;
};

export async function resnapshotPendingShipHours(
  userId: string,
  accessToken: string,
): Promise<number> {
  const pending = await db
    .select({
      ship_id: shipTable.id,
      ship_status: shipTable.status,
      ship_project_id: shipTable.project_id,
      ship_hackatime_projects: shipTable.hackatime_projects,
      ship_hackatime_hours: shipTable.hackatime_hours,
      project_guide: projectTable.guide,
    })
    .from(shipTable)
    .innerJoin(projectTable, eq(projectTable.id, shipTable.project_id))
    .where(
      and(
        eq(projectTable.user_id, userId),
        inArray(shipTable.status, REVIEW_QUEUE_STATUSES as unknown as string[]),
      ),
    );

  if (pending.length === 0) return 0;

  // Every ship's hours floor is MACONDO_HOURS_START_DATE, so one fetch serves every pending row.
  let projectTotals: Awaited<ReturnType<typeof getAuthenticatedProjects>> = null;
  try {
    projectTotals = await getAuthenticatedProjects(accessToken, {
      startDate: MACONDO_HOURS_START_DATE,
    });
  } catch (err) {
    console.error(`[batch-sync] resnapshot fetch failed for ${userId}`, err);
    return 0;
  }
  if (!projectTotals?.projects?.length) return 0;

  const byName = new Map<string, number>();
  for (const p of projectTotals.projects) {
    if (!p?.name) continue;
    byName.set(p.name, p.total_seconds ?? 0);
  }

  // Cached so several pending ships on one project don't each query.
  const earliestShipByProject = new Map<number, number | null>();

  let updated = 0;
  for (const row of pending) {
    const linked = Array.from(new Set(row.ship_hackatime_projects ?? []));
    let earliestShipId = earliestShipByProject.get(row.ship_project_id);
    if (earliestShipId === undefined) {
      const [earliestRow] = await db
        .select({ id: shipTable.id })
        .from(shipTable)
        .where(eq(shipTable.project_id, row.ship_project_id))
        .orderBy(asc(shipTable.id))
        .limit(1);
      earliestShipId = earliestRow?.id ?? null;
      earliestShipByProject.set(row.ship_project_id, earliestShipId);
    }
    // Only the html tutorial's earliest ship earns the +1h bonus; other guides are real projects.
    const tutorialBonus =
      row.project_guide === "html" && earliestShipId === row.ship_id
        ? TUTORIAL_BONUS_HOURS
        : 0;
    if (linked.length === 0 && tutorialBonus === 0) continue;
    const totalSeconds = linked.reduce(
      (sum, name) => sum + (byName.get(name) ?? 0),
      0,
    );
    const hours =
      Math.round((totalSeconds / 3600 + tutorialBonus) * 100) / 100; // seconds to hours, 2 decimals
    if (hours === row.ship_hackatime_hours) continue;
    try {
      await db
        .update(shipTable)
        .set({ hackatime_hours: hours })
        .where(eq(shipTable.id, row.ship_id));
      updated += 1;
    } catch (err) {
      console.error(`[batch-sync] ship resnapshot failed for ship ${row.ship_id}`, err);
    }
  }

  return updated;
}

export async function runBatchHackatimeSync(opts?: {
  source?: BatchSyncSource;
  concurrency?: number;
  // Clean-slate recompute for admin buttons (clears Redis delta cache, resets project streaks); too costly for cron.
  forceClean?: boolean;
  // YYYY-MM-DD compared to users.last_active_date (hourly cadence); omit for a full scan.
  activeSince?: string;
}): Promise<BatchSyncReport> {
  const source: BatchSyncSource = opts?.source ?? "manual";
  const forceClean = opts?.forceClean ?? false;
  const activeSince = opts?.activeSince ?? null;
  const startedAt = Date.now();

  const targets = await db
    .select({
      id: users.id,
      timezone: users.timezone,
      hackatime_id: users.hackatime_id,
      hackatime_timezone: users.hackatime_timezone,
      hackatime_oauth_token: users.hackatime_oauth_token,
      hackatime_api_status: users.hackatime_api_status,
      last_hackatime_synced_at: users.last_hackatime_synced_at,
      last_hackatime_total_seconds: users.last_hackatime_total_seconds,
      last_hackatime_total_hours: users.last_hackatime_total_hours,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.hackatime_oauth_token),
        eq(users.is_temp, false),
        // drizzle's and() ignores undefined, so the full run stays unfiltered.
        activeSince ? gte(users.last_active_date, activeSince) : undefined,
        // Dead / restricted tokens would 401 hourly; the daily run's /hours call is their self-heal probe.
        activeSince ? eq(users.hackatime_api_status, "ok") : undefined,
      ),
    );

  const results: BatchSyncOutcome[] = [];
  let cursor = 0;

  async function workOne(): Promise<void> {
    while (cursor < targets.length) {
      const target = targets[cursor++]!;
      const token = target.hackatime_oauth_token;
      if (!token) {
        results.push({ user_id: target.id, ok: false, reason: "no_token" });
        continue;
      }

      try {
        const hours = await getAuthenticatedHours(token);
        if (!hours) {
          // Persist the verdict so other sweeps skip this user instead of a ~60-call fan-out per 401.
          // Already-marked users skip the probe: this daily /hours call is their re-check.
          let reason = "fetch_failed";
          if (target.hackatime_api_status === "ok") {
            const failure = await classifyHackatimeAuthFailure(token);
            if (failure !== "unknown") {
              reason = failure;
              try {
                await db
                  .update(users)
                  .set({
                    hackatime_api_status: failure,
                    hackatime_api_status_changed_at: new Date(),
                  })
                  .where(eq(users.id, target.id));
              } catch (err) {
                console.error(
                  `[batch-sync] failed to mark hackatime_api_status for ${target.id}`,
                  err,
                );
              }
            }
          } else {
            reason = target.hackatime_api_status;
          }
          results.push({ user_id: target.id, ok: false, reason });
          continue;
        }

        const totalSeconds = Math.max(0, Math.floor(hours.total_seconds ?? 0));
        const totalHours = Math.round((totalSeconds / 3600) * 100) / 100; // seconds to hours, 2 decimals
        const isFirstSync = target.last_hackatime_synced_at === null;
        const previousSecondsRaw = target.last_hackatime_total_seconds;
        const previousSeconds =
          previousSecondsRaw == null
            ? Math.round((target.last_hackatime_total_hours ?? 0) * 3600)
            : previousSecondsRaw;
        const deltaSeconds = isFirstSync ? 0 : Math.max(0, totalSeconds - previousSeconds);
        const now = new Date();

        await db
          .update(users)
          .set({
            last_hackatime_total_hours: totalHours,
            last_hackatime_total_seconds: totalSeconds,
            last_hackatime_synced_at: now,
            // A working /hours call heals the mark; clear it before downstream helpers re-read the row.
            ...(target.hackatime_api_status !== "ok"
              ? {
                  hackatime_api_status: "ok",
                  hackatime_api_status_changed_at: now,
                }
              : {}),
          })
          .where(eq(users.id, target.id));

        // Sync the timezone first so this tick buckets days in the corrected zone.
        const adminKey =
          (useRuntimeConfig().hackatimeAdminKey as string | undefined) ?? null;
        const effectiveTz = (await syncHackatimeTimezone({
          userId: target.id,
          hackatimeId: target.hackatime_id ?? null,
          adminKey,
          currentTimezone: target.timezone ?? null,
          currentHackatimeTimezone: target.hackatime_timezone ?? null,
        })) ?? target.timezone ?? null;

        let extendedUserStreak = false;
        const extendedProjects: number[] = [];
        if (!isFirstSync && deltaSeconds > 0) {
          try {
            const linkedSecondsToday = await getUserLinkedHackatimeSecondsToday(
              target.id,
            );
            // Record partial activity too; extendStreak's own 1h threshold gates the counter bump.
            if (linkedSecondsToday > 0) {
              extendedUserStreak = (await extendStreak(
                target.id,
                "hackatime",
                linkedSecondsToday,
                now,
              )).activated;
            }
          } catch (err) {
            console.error(`[batch-sync] extendStreak failed for ${target.id}`, err);
          }
        }
        if (!isFirstSync) {
          if (forceClean) {
            try {
              await clearStreakCacheForUser(target.id, effectiveTz);
              await resetUserProjectStreaks(target.id);
            } catch (err) {
              console.error(
                `[batch-sync] clean-slate reset failed for ${target.id}`,
                err,
              );
            }
          }

          // Skip the costly from-scratch walk on zero-delta hourly ticks: they can't change the streak.
          // Journal POSTs record their own streak day, and the daily full pass converges any drift.
          if (forceClean || deltaSeconds > 0 || source !== "scheduled_active") {
            try {
              extendedProjects.push(...(await extendProjectStreaksFromHackatime(
                target.id,
                token,
                effectiveTz,
              )).extended);
            } catch (err) {
              console.error(
                `[batch-sync] extendProjectStreaksFromHackatime failed for ${target.id}`,
                err,
              );
            }
            // The per-user extend skips team projects; recompute them from the whole team's activity.
            try {
              await Promise.all(
                (await getActiveTeamProjectIdsForMember(target.id)).map((pid) =>
                  recomputeTeamProjectStreak(pid).catch((err) => {
                    console.error(
                      `[batch-sync] recomputeTeamProjectStreak ${pid} failed for ${target.id}`,
                      err,
                    );
                  }),
                ),
              );
            } catch (err) {
              console.error(
                `[batch-sync] team streak recompute failed for ${target.id}`,
                err,
              );
            }
          }
        }

        let shipsResnapped = 0;
        try {
          shipsResnapped = await resnapshotPendingShipHours(target.id, token);
        } catch (err) {
          console.error(`[batch-sync] resnapshot ships failed for ${target.id}`, err);
        }

        try {
          await backfillUserActivity(target.id, token, effectiveTz);
        } catch (err) {
          console.error(`[batch-sync] daily activity backfill failed for ${target.id}`, err);
        }

        await db.insert(hackatimeSyncAuditTable).values({
          user_id: target.id,
          total_hours: totalHours,
          delta_hours: Math.round((deltaSeconds / 3600) * 100) / 100, // seconds to hours, 2 decimals
          sync_date: now.toISOString().slice(0, 10), // YYYY-MM-DD
          extended_streak: extendedUserStreak,
          source: isFirstSync ? "first_sync_seed" : `batch_${source}`,
        });

        results.push({
          user_id: target.id,
          ok: true,
          delta_seconds: deltaSeconds,
          extended: extendedProjects,
          ships_resnapped: shipsResnapped,
        });
      } catch (err) {
        console.error(`[batch-sync] sync failed for ${target.id}`, err);
        results.push({
          user_id: target.id,
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(opts?.concurrency ?? 5, targets.length) }, () => workOne()), // 5 users in parallel by default
  );

  const ok = results.filter((r) => r.ok).length;

  return {
    scanned: targets.length,
    synced: ok,
    failed: results.length - ok,
    project_streaks_extended: results.reduce(
      (n, r) => n + (r.extended?.length ?? 0),
      0,
    ),
    ships_resnapshotted: results.reduce(
      (n, r) => n + (r.ships_resnapped ?? 0),
      0,
    ),
    failures: results.filter((r) => !r.ok).slice(0, 50), // cap failures listed in the report
    duration_ms: Date.now() - startedAt,
  };
}
