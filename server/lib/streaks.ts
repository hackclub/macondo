import { createHash } from "node:crypto";

import { useRuntimeConfig } from "#imports";

import { and, between, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import db from "../db";
import {
  users,
  projectTable,
  projectCollaboratorTable,
  projectHackatimeLinksTable,
  auditLogTable,
  journalsTable,
  streakDaysTable,
  dailyProjectActivityTable,
  shipTable,
} from "../db/schema";
import { getAuthenticatedProjects } from "./hackatime";
import { getRedis } from "./redis";
import { notify } from "./notify";
import {
  HACKATIME_STREAK_DAY_SECONDS as HACKATIME_STREAK_DAY_SECONDS_HELPER,
  computeWorkAvailableReviewProtectedDays,
  computeTeamRecompute,
  currentStreakLengthFromDays,
  dashboardStreak,
  dayInTz,
  dayQualifiesForProjectStreak,
  dayQualifiesForUserStreak,
  effectiveHackatimeNamesByProject,
  freezeRefundedNotification,
  HACKATIME_HEARTBEAT_TIMEOUT_SECONDS,
  hasProtectableProjectStreak,
  hoursToSeconds,
  inPostMidnightGrace,
  mergedGapSumSeconds,
  optedOutCreditedRun,
  optedOutProjectStreakFromDays,
  pendingDaysToRequalify,
  type ReviewBridgeShip,
  reviewBridgeDaysForProject,
  planFreezeRefund,
  planReviewProtectionBackfill,
  planStrandedFreezeBackfill,
  projectDayCountsForStreak,
  recomputeWalkFloor,
  resolveRecomputedStreak,
  streakDayKey,
  syncLastActiveCandidate,
  todayStr,
  unreliableDaysAfterTruncation,
  yesterdayStr,
} from "./streak-helpers";
import { HACKATIME_ADMIN_API_URL } from "./api-urls";
import { macondoHasEnded } from "./macondo-end";

export { dayInTz, dayQualifiesForProjectStreak, streakDayKey, todayStr };

// Re-exported so imports from ./streaks keep working; defined in the DB-free helpers file.
export const HACKATIME_STREAK_DAY_SECONDS = HACKATIME_STREAK_DAY_SECONDS_HELPER;
const HACKATIME_STREAK_LOOKBACK_DAYS = 31;

// A day counts toward the user streak when hackatime + journal seconds (summed across
// projects) reach this; same combined rule as the project-level streak.
export const USER_STREAK_THRESHOLD_SECONDS = 60 * 60;

// Cap on streak_freezes_remaining, enforced at purchase and milestone grant.
export const MAX_STREAK_FREEZES = 5;
// Earliest date hackatime hours count toward a ship total.
export const MACONDO_HOURS_START_DATE = "2026-04-15";

// Later than the hours start so the onboarding week doesn't inflate streaks.
export const MACONDO_STREAK_START_DATE = "2026-04-21";

function dayFromCreatedAt(
  projectCreatedAt: Date | string | null | undefined,
  fallback: string,
  tz?: string | null,
): string {
  let created: Date | null = null;
  if (projectCreatedAt instanceof Date && !Number.isNaN(projectCreatedAt.getTime())) {
    created = projectCreatedAt;
  } else if (typeof projectCreatedAt === "string" && projectCreatedAt) {
    const d = new Date(projectCreatedAt);
    if (!Number.isNaN(d.getTime())) created = d;
  }
  if (!created) return fallback;
  // Local day, not a UTC slice, or west-of-UTC evening projects get floored a day late.
  return streakDayKey(created, tz);
}

// Uses the later streak start so the program's first days don't spawn streak credit.
export function projectStreakFloor(
  projectCreatedAt: Date | string | null | undefined,
  tz?: string | null,
): string {
  const createdDay = dayFromCreatedAt(projectCreatedAt, MACONDO_STREAK_START_DATE, tz);
  return createdDay >= MACONDO_STREAK_START_DATE ? createdDay : MACONDO_STREAK_START_DATE;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000, // ms per day
  );
}

export type StreakSource =
  | "journal"
  | "journal_unarchive"
  | "hackatime"
  | "first_sync_seed";

export interface StreakResult {
  streak_freezes_remaining: number;
  // true when this call made today's streak_days row active
  activated: boolean;
}

export interface ProjectStreakResult extends StreakResult {
  project_streak_days: number;
  project_stage: 1 | 2 | 3 | 4;
}

export function streakToStage(projectStreakDays: number): 1 | 2 | 3 | 4 {
  if (projectStreakDays >= 10) return 4;
  if (projectStreakDays >= 6) return 3;
  if (projectStreakDays >= 3) return 2;
  return 1;
}

export function projectMultiplier(projectStreakDays: number): number {
  return 1 + projectStreakDays * 0.01; // +1% per streak day
}

export { effectiveStreakDaysForShip, projectMultiplierForRun } from "./streak-helpers";

// Prefers streak_days; falls back to projects.last_worked_date when no row exists today.
export async function userQualifiedAnyProjectToday(
  userId: string,
  today: string,
): Promise<boolean> {
  const [row] = await db
    .select({ status: streakDaysTable.status })
    .from(streakDaysTable)
    .where(
      and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, today)),
    )
    .limit(1);
  if (row?.status === "active") return true;
  if (row?.status === "frozen" || row?.status === "missed") return false;
  const [projHit] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.user_id, userId),
        eq(projectTable.last_worked_date, today),
      ),
    )
    .limit(1);
  return !!projHit;
}

type StreakDaySignal =
  | { type: "journal" }
  | { type: "hackatime"; secondsToday: number };

interface StreakDayState {
  status: "pending" | "active" | "frozen" | "missed";
  wasAlreadyActive: boolean;
  seconds_logged: number;
  had_journal: boolean;
}

/**
 * Idempotent per signal: hackatime seconds are set, not added. Flips pending
 * (or frozen) to active once hackatime + journal seconds reach the threshold.
 */
async function recordStreakDay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  userId: string,
  day: string,
  signal: StreakDaySignal,
): Promise<StreakDayState> {
  const [existing] = await tx
    .select({
      status: streakDaysTable.status,
      seconds_logged: streakDaysTable.seconds_logged,
      had_journal: streakDaysTable.had_journal,
    })
    .from(streakDaysTable)
    .where(
      and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, day)),
    )
    .for("update")
    .limit(1);

  // Hackatime seconds are an absolute daily total; max keeps seconds_logged monotonic.
  const prevSeconds = existing?.seconds_logged ?? 0;
  const prevJournal = existing?.had_journal ?? false;
  const newSeconds =
    signal.type === "hackatime"
      ? Math.max(prevSeconds, Math.max(0, Math.floor(signal.secondsToday)))
      : prevSeconds;
  const newJournal = signal.type === "journal" ? true : prevJournal;

  // Journal seconds come from DPA (written before this call). Hackatime uses newSeconds,
  // not DPA, because batch sync writes DPA after extendStreak runs.
  const [dpaTotals] = await tx
    .select({
      journal_seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.journal_seconds}), 0)::int`,
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, userId),
        eq(dailyProjectActivityTable.day, day),
      ),
    );
  const meetsThreshold = dayQualifiesForUserStreak({
    hackatimeSeconds: newSeconds,
    journalSeconds: Number(dpaTotals?.journal_seconds ?? 0),
    threshold: USER_STREAK_THRESHOLD_SECONDS,
  });

  // active is sticky; frozen can flip to active on late data (freeze refunded below);
  // missed is terminal.
  let newStatus: "pending" | "active" | "frozen" | "missed" =
    existing?.status ?? "pending";
  if ((newStatus === "pending" || newStatus === "frozen") && meetsThreshold) {
    newStatus = "active";
  }

  // FOR UPDATE can't lock a missing row, so concurrent first inserts need ON CONFLICT.
  await tx
    .insert(streakDaysTable)
    .values({
      user_id: userId,
      day,
      status: newStatus,
      seconds_logged: newSeconds,
      had_journal: newJournal,
    })
    .onConflictDoUpdate({
      target: [streakDaysTable.user_id, streakDaysTable.day],
      set: {
        status: newStatus,
        seconds_logged: newSeconds,
        had_journal: newJournal,
        updated_at: new Date(),
      },
    });

  // Late data showed the frozen day qualified: refund its freeze, capped at
  // MAX_STREAK_FREEZES. last_active_date already moved past it in reconcile.
  if (existing?.status === "frozen" && newStatus === "active") {
    // Lock users so concurrent refunds for different days can't lose an increment.
    const [pre] = await tx
      .select({ streak_freezes_remaining: users.streak_freezes_remaining })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    const oldFreezes = pre?.streak_freezes_remaining ?? 0;
    const cappedNew = Math.min(MAX_STREAK_FREEZES, oldFreezes + 1);
    const refunded = cappedNew > oldFreezes;
    if (refunded) {
      await tx
        .update(users)
        .set({ streak_freezes_remaining: cappedNew })
        .where(eq(users.id, userId));
    }
    await tx.insert(auditLogTable).values({
      actor_id: userId,
      action: "streak_freeze_refunded_late_activity",
      entity_type: "user",
      entity_id: userId,
      old_value: {
        day,
        freezes: oldFreezes,
        prior_status: "frozen",
        prior_seconds: prevSeconds,
        prior_journal: prevJournal,
      },
      new_value: {
        day,
        freezes: cappedNew,
        status: "active",
        seconds_logged: newSeconds,
        had_journal: newJournal,
        refunded,
      },
      sensitive: false,
      public_message: refunded
        ? `Refunded 1 streak freeze: ${day} qualified after late activity arrived.`
        : `Promoted ${day} to active after late activity; freeze not refunded (already at cap).`,
      change_summary: "streak_freeze_refunded_late_activity",
    });
  }

  return {
    status: newStatus,
    wasAlreadyActive: existing?.status === "active",
    seconds_logged: newSeconds,
    had_journal: newJournal,
  };
}

/**
 * Promotes past `pending` days to `active` once their journal seconds grew
 * (cross-day edits, tz re-bucketing). Qualify-up only and never touches
 * frozen/missed rows; last_active_date is left alone so dormant users aren't re-enrolled.
 */
export async function requalifyPendingStreakDaysForUser(
  userId: string,
  timezone: string | null,
  opts?: { day?: string; now?: Date },
): Promise<{ requalified: string[] }> {
  const today = streakDayKey(opts?.now ?? new Date(), timezone);

  // Strictly before today: today self-heals via extendStreak, and touching it
  // here would race that writer.
  const dayCond = opts?.day
    ? inArray(streakDaysTable.day, [opts.day])
    : between(
        streakDaysTable.day,
        shiftDay(today, -60), // requalify lookback days, bounds batch-sync scan
        yesterdayStr(today),
      );
  if (opts?.day && opts.day >= today) return { requalified: [] };

  const pendingRows = await db
    .select({
      day: streakDaysTable.day,
      status: streakDaysTable.status,
      seconds_logged: streakDaysTable.seconds_logged,
    })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        eq(streakDaysTable.status, "pending"),
        dayCond,
      ),
    );
  if (pendingRows.length === 0) return { requalified: [] };

  // Hackatime uses the row's seconds_logged, not DPA, mirroring recordStreakDay (DPA can lag).
  const dpaRows = await db
    .select({
      day: dailyProjectActivityTable.day,
      journal_seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.journal_seconds}), 0)::int`,
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, userId),
        inArray(dailyProjectActivityTable.day, pendingRows.map((r) => r.day)),
      ),
    )
    .groupBy(dailyProjectActivityTable.day);
  const journalByDay = new Map(
    dpaRows.map((r) => [r.day, Number(r.journal_seconds)]),
  );

  const toFlip = pendingDaysToRequalify(
    pendingRows.map((r) => ({
      day: r.day,
      status: r.status,
      hackatimeSeconds: r.seconds_logged,
      journalSeconds: journalByDay.get(r.day) ?? 0,
    })),
    USER_STREAK_THRESHOLD_SECONDS,
  );
  if (toFlip.length === 0) return { requalified: [] };

  const requalified: string[] = [];
  await db.transaction(async (tx) => {
    for (const day of toFlip) {
      // Re-check under lock: another writer may have moved this row off pending.
      const [locked] = await tx
        .select({
          status: streakDaysTable.status,
          seconds_logged: streakDaysTable.seconds_logged,
        })
        .from(streakDaysTable)
        .where(
          and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, day)),
        )
        .for("update")
        .limit(1);
      if (!locked || locked.status !== "pending") continue;

      await tx
        .update(streakDaysTable)
        .set({ status: "active", updated_at: new Date() })
        .where(
          and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, day)),
        );

      await tx.insert(auditLogTable).values({
        actor_id: userId,
        action: "streak_day_requalified",
        entity_type: "user",
        entity_id: userId,
        old_value: {
          day,
          status: "pending",
          seconds_logged: locked.seconds_logged,
        },
        new_value: {
          day,
          status: "active",
          journal_seconds: journalByDay.get(day) ?? 0,
        },
        sensitive: false,
        public_message: `Day ${day} re-qualified for the streak after its journal hours were counted.`,
        change_summary: "streak_day_requalified",
      });
      requalified.push(day);
    }
  });
  return { requalified };
}

/**
 * Records that the user worked today without a project context (hackatime sync).
 * Project streaks are bumped later in extendProjectStreaksFromHackatime.
 */
export async function extendStreak(
  userId: string,
  source: StreakSource,
  hackatimeSecondsToday?: number,
  now: Date = new Date(),
): Promise<StreakResult> {
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({
        streak_freezes_remaining: users.streak_freezes_remaining,
        last_active_date: users.last_active_date,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    if (!u) throw new Error(`extendStreak: user ${userId} not found`);

    // Caller's now keeps the day key consistent with its other writes so a
    // near-midnight submit can't land on two days; tz sets the local midnight.
    const today = streakDayKey(now, u.timezone);
    const signal: StreakDaySignal =
      source === "journal" || source === "journal_unarchive"
        ? { type: "journal" }
        : { type: "hackatime", secondsToday: hackatimeSecondsToday ?? 0 };
    const dayState = await recordStreakDay(tx, userId, today, signal);

    if (dayState.status !== "active") {
      return {
        streak_freezes_remaining: u.streak_freezes_remaining,
        activated: false,
      };
    }

    if (u.last_active_date !== today) {
      await tx
        .update(users)
        .set({ last_active_date: today })
        .where(eq(users.id, userId));
    }

    return {
      streak_freezes_remaining: u.streak_freezes_remaining,
      activated: !dayState.wasAlreadyActive,
    };
  });
}

/**
 * journalId lands in the audit row so cheesing detection can join streak
 * events back to specific journals.
 */
export async function extendProjectStreak(
  userId: string,
  projectId: number,
  source: "journal" | "journal_unarchive",
  journalId?: number,
  now: Date = new Date(),
): Promise<ProjectStreakResult> {
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({
        streak_freezes_remaining: users.streak_freezes_remaining,
        last_active_date: users.last_active_date,
        timezone: users.timezone,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    if (!u) throw new Error(`extendProjectStreak: user ${userId} not found`);

    // Caller's now matches its DPA write's day key so a near-midnight submit
    // can't land DPA and streak_days on different days.
    const today = streakDayKey(now, u.timezone);

    const dayState = await recordStreakDay(tx, userId, today, {
      type: "journal",
    });

    if (u.last_active_date !== today) {
      await tx
        .update(users)
        .set({ last_active_date: today })
        .where(eq(users.id, userId));
    }

    const [p] = await tx
      .select({
        id: projectTable.id,
        user_id: projectTable.user_id,
        project_streak_days: projectTable.project_streak_days,
        last_worked_date: projectTable.last_worked_date,
        stage: projectTable.stage,
      })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .for("update")
      .limit(1);
    if (!p) throw new Error(`extendProjectStreak: project ${projectId} not found`);
    if (p.user_id !== userId) {
      throw new Error(
        `extendProjectStreak: project ${projectId} not owned by user ${userId}`,
      );
    }

    let newProjectStreakDays = p.project_streak_days;
    let newStage: 1 | 2 | 3 | 4 = streakToStage(newProjectStreakDays);

    if (p.last_worked_date !== today) {
      // DPA is updated by the journal handlers before this call; no row means
      // the day doesn't qualify.
      const [todayActivity] = await tx
        .select({
          journal_seconds: dailyProjectActivityTable.journal_seconds,
          hackatime_seconds: dailyProjectActivityTable.hackatime_seconds,
        })
        .from(dailyProjectActivityTable)
        .where(
          and(
            eq(dailyProjectActivityTable.user_id, userId),
            eq(dailyProjectActivityTable.project_id, projectId),
            eq(dailyProjectActivityTable.day, today),
          ),
        )
        .limit(1);
      const journalSec = todayActivity?.journal_seconds ?? 0;
      const hackatimeSec = todayActivity?.hackatime_seconds ?? 0;
      // live and stored are the same DPA snapshot here, so the helper's
      // max-then-add doesn't double-count.
      if (
        dayQualifiesForProjectStreak({
          liveSeconds: hackatimeSec,
          storedSeconds: hackatimeSec,
          journalSeconds: journalSec,
        })
      ) {
        // Project streaks only extend; only a global missed day (reconcile) resets them.
        newProjectStreakDays = p.project_streak_days + 1;
        newStage = streakToStage(newProjectStreakDays);
        await tx
          .update(projectTable)
          .set({
            project_streak_days: newProjectStreakDays,
            last_worked_date: today,
            stage: newStage,
            updated_at: new Date(),
          })
          .where(eq(projectTable.id, projectId));

        await tx.insert(auditLogTable).values({
          actor_id: userId,
          action: "project_streak_extend",
          entity_type: "project",
          entity_id: String(projectId),
          old_value: {
            project_streak_days: p.project_streak_days,
            last_worked_date: p.last_worked_date,
            stage: p.stage,
          },
          new_value: {
            project_streak_days: newProjectStreakDays,
            last_worked_date: today,
            stage: newStage,
            source,
            journal_id: journalId ?? null,
            journal_seconds: journalSec,
            hackatime_seconds: hackatimeSec,
          },
          sensitive: false,
          public_message: `Project streak extended to ${newProjectStreakDays} (source: ${source})`,
          change_summary: source,
        });
      }
    }

    return {
      streak_freezes_remaining: u.streak_freezes_remaining,
      activated: !dayState.wasAlreadyActive && dayState.status === "active",
      project_streak_days: newProjectStreakDays,
      project_stage: newStage,
    };
  });
}

/**
 * Hackatime names on team projects the user actively collaborates on (not owns), so
 * their own hours there count toward their user streak. Callers only sum the user's
 * own heartbeats against these, so no one is credited for another's time.
 */
async function getActiveCollaboratorHackatimeNames(
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ hackatime_projects: projectTable.hackatime_projects })
    .from(projectCollaboratorTable)
    .innerJoin(
      projectTable,
      eq(projectTable.id, projectCollaboratorTable.project_id),
    )
    .where(
      and(
        eq(projectCollaboratorTable.user_id, userId),
        eq(projectCollaboratorTable.status, "active"),
      ),
    );
  const names: string[] = [];
  for (const r of rows) {
    for (const n of r.hackatime_projects ?? []) names.push(n);
  }
  return names;
}

/**
 * Only linked hackatime projects count, so unrelated work never extends the profile
 * streak. Errors return 0 so an outage doesn't block extension; the next sync retries.
 */
export async function getUserLinkedHackatimeSecondsToday(
  userId: string,
): Promise<number> {
  const [u] = await db
    .select({
      hackatime_oauth_token: users.hackatime_oauth_token,
      hackatime_api_status: users.hackatime_api_status,
      hackatime_id: users.hackatime_id,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.hackatime_oauth_token) return 0;
  // Dead/restricted token: every OAuth call would 401. Batch sync clears the mark when it heals.
  if (u.hackatime_api_status !== "ok") return 0;

  const projects = await db
    .select({ hackatime_projects: projectTable.hackatime_projects })
    .from(projectTable)
    .where(eq(projectTable.user_id, userId));

  const linkedSet = new Set<string>();
  for (const p of projects) {
    for (const name of p.hackatime_projects ?? []) linkedSet.add(name);
  }
  // Collaborated team projects count too; only the user's own heartbeats are summed.
  for (const name of await getActiveCollaboratorHackatimeNames(userId)) {
    linkedSet.add(name);
  }
  if (linkedSet.size === 0) return 0;
  const linkedNames = [...linkedSet];

  // syncHackatimeTimezone runs before this in both sync callers, so users.timezone is current.
  const today = streakDayKey(new Date(), u.timezone);

  // Heartbeats bucket by the user's local midnight; the cumulative OAuth API uses UTC midnight
  // and undercounts west-of-UTC evenings. Fall back to it when inputs are missing or this fails.
  const adminKey =
    (useRuntimeConfig().hackatimeAdminKey as string | undefined) ?? null;
  if (u.hackatime_id && adminKey && u.timezone) {
    try {
      const { beatsByDay, failedDays } =
        await fetchPerProjectDailyDurationsByLocalDay(
          u.hackatime_id,
          adminKey,
          u.timezone,
          today,
        );
      // A failed today falls through instead of reporting 0. Merging wall-clock time avoids
      // double-counting cross-project switches inside the heartbeat timeout.
      if (!failedDays.has(today)) {
        return mergedDayProjectSeconds(beatsByDay ?? new Map(), today, linkedNames);
      }
    } catch {
      console.error(
        "[streaks] heartbeat today-seconds failed; falling back to cumulative",
      );
    }
  }

  // Buckets at UTC midnight; only used when the heartbeat path is unavailable.
  try {
    const resp = await getAuthenticatedProjects(u.hackatime_oauth_token, {
      startDate: today,
    });
    let sum = 0;
    for (const hp of resp?.projects ?? []) {
      if (hp?.name && linkedSet.has(hp.name)) {
        sum += Math.max(0, Math.floor(hp.total_seconds ?? 0));
      }
    }
    return sum;
  } catch {
    console.error(
      "[streaks] getUserLinkedHackatimeSecondsToday failed",
    );
    return 0;
  }
}

/**
 * Linked-project hackatime seconds for a past day, via cumSince(day) - cumSince(day+1).
 * Stable deltas share fetchPerProjectDailyDurations' Redis cache. Errors return 0 and
 * callers fall back to streak_days / DPA signals.
 */
export async function getUserLinkedHackatimeSecondsForDay(
  userId: string,
  day: string,
  opts?: { forceFresh?: boolean },
): Promise<number> {
  // forceFresh skips the delta cache: the late-activity refund sweep needs heartbeats
  // that a stale cached delta would hide.
  const forceFresh = opts?.forceFresh ?? false;
  const [u] = await db
    .select({
      hackatime_oauth_token: users.hackatime_oauth_token,
      hackatime_api_status: users.hackatime_api_status,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.hackatime_oauth_token) return 0;
  // Dead/restricted token would 401 on both calls; skip them to avoid a 401 flood.
  if (u.hackatime_api_status !== "ok") return 0;

  // Local-day today to match streak_days.day keys, which are bucketed per user tz.
  const today = streakDayKey(new Date(), u.timezone);
  if (day >= today) return getUserLinkedHackatimeSecondsToday(userId);

  const projects = await db
    .select({ hackatime_projects: projectTable.hackatime_projects })
    .from(projectTable)
    .where(eq(projectTable.user_id, userId));
  const linkedSet = new Set<string>();
  for (const p of projects) {
    for (const name of p.hackatime_projects ?? []) linkedSet.add(name);
  }
  // Collaborated team projects count too, so the reconcile recheck doesn't break a
  // shared-project day.
  for (const name of await getActiveCollaboratorHackatimeNames(userId)) {
    linkedSet.add(name);
  }
  if (linkedSet.size === 0) return 0;

  const isStable = daysBetween(day, today) >= STREAK_CACHE_STABLE_AGE_DAYS;
  if (isStable && !forceFresh) {
    const cached = await readDeltaCache(userId, day);
    if (cached) {
      let sum = 0;
      const seen = new Set<string>();
      for (const name of linkedSet) {
        if (seen.has(name)) continue;
        seen.add(name);
        sum += cached.get(name) ?? 0;
      }
      return sum;
    }
  }

  const nextDay = shiftDay(day, 1);
  try {
    const [respDay, respNext] = await Promise.all([
      getAuthenticatedProjects(u.hackatime_oauth_token, { startDate: day }),
      getAuthenticatedProjects(u.hackatime_oauth_token, { startDate: nextDay }),
    ]);
    const cumDay = new Map<string, number>();
    for (const hp of respDay?.projects ?? []) {
      if (hp?.name) {
        cumDay.set(hp.name, Math.max(0, Math.floor(hp.total_seconds ?? 0)));
      }
    }
    const cumNext = new Map<string, number>();
    for (const hp of respNext?.projects ?? []) {
      if (hp?.name) {
        cumNext.set(hp.name, Math.max(0, Math.floor(hp.total_seconds ?? 0)));
      }
    }
    const delta = new Map<string, number>();
    for (const name of new Set<string>([...cumDay.keys(), ...cumNext.keys()])) {
      delta.set(
        name,
        Math.max(0, (cumDay.get(name) ?? 0) - (cumNext.get(name) ?? 0)),
      );
    }
    if (isStable) await writeDeltaCache(userId, day, delta);

    let sum = 0;
    const seen = new Set<string>();
    for (const name of linkedSet) {
      if (seen.has(name)) continue;
      seen.add(name);
      sum += delta.get(name) ?? 0;
    }
    return sum;
  } catch (err) {
    console.error(
      `[streaks] getUserLinkedHackatimeSecondsForDay failed for user ${userId} day ${day}:`,
      err,
    );
    return 0;
  }
}

/**
 * The user's own hackatime seconds on an explicit name set for one local day, so team
 * streaks count only a mixed collaborator's shared-repo hours. Kept separate from the
 * linked-set variant so the headline-streak path stays untouched.
 */
export async function getUserHackatimeSecondsForNamesForDay(
  userId: string,
  names: string[],
  day: string,
): Promise<number> {
  const nameSet = new Set(names.filter(Boolean));
  if (nameSet.size === 0) return 0;
  const [u] = await db
    .select({
      hackatime_oauth_token: users.hackatime_oauth_token,
      hackatime_api_status: users.hackatime_api_status,
      hackatime_id: users.hackatime_id,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.hackatime_oauth_token) return 0;
  if (u.hackatime_api_status !== "ok") return 0;

  const today = streakDayKey(new Date(), u.timezone);

  if (day >= today) {
    const adminKey =
      (useRuntimeConfig().hackatimeAdminKey as string | undefined) ?? null;
    if (u.hackatime_id && adminKey && u.timezone) {
      try {
        const { beatsByDay, failedDays } =
          await fetchPerProjectDailyDurationsByLocalDay(
            u.hackatime_id,
            adminKey,
            u.timezone,
            today,
          );
        if (!failedDays.has(today)) {
          return mergedDayProjectSeconds(beatsByDay ?? new Map(), today, [
            ...nameSet,
          ]);
        }
      } catch (err) {
        console.error(
          `[streaks] scoped heartbeat today-seconds failed for user ${userId}; falling back to cumulative:`,
          err,
        );
      }
    }
    try {
      const resp = await getAuthenticatedProjects(u.hackatime_oauth_token, {
        startDate: today,
      });
      let sum = 0;
      for (const hp of resp?.projects ?? []) {
        if (hp?.name && nameSet.has(hp.name)) {
          sum += Math.max(0, Math.floor(hp.total_seconds ?? 0));
        }
      }
      return sum;
    } catch (err) {
      console.error(
        `[streaks] getUserHackatimeSecondsForNamesForDay today failed for user ${userId}:`,
        err,
      );
      return 0;
    }
  }

  // Past day: cumSince(day) - cumSince(day+1), with the shared delta cache.
  const isStable = daysBetween(day, today) >= STREAK_CACHE_STABLE_AGE_DAYS;
  if (isStable) {
    const cached = await readDeltaCache(userId, day);
    if (cached) {
      let sum = 0;
      for (const name of nameSet) sum += cached.get(name) ?? 0;
      return sum;
    }
  }
  const nextDay = shiftDay(day, 1);
  try {
    const [respDay, respNext] = await Promise.all([
      getAuthenticatedProjects(u.hackatime_oauth_token, { startDate: day }),
      getAuthenticatedProjects(u.hackatime_oauth_token, { startDate: nextDay }),
    ]);
    const cumDay = new Map<string, number>();
    for (const hp of respDay?.projects ?? []) {
      if (hp?.name) {
        cumDay.set(hp.name, Math.max(0, Math.floor(hp.total_seconds ?? 0)));
      }
    }
    const cumNext = new Map<string, number>();
    for (const hp of respNext?.projects ?? []) {
      if (hp?.name) {
        cumNext.set(hp.name, Math.max(0, Math.floor(hp.total_seconds ?? 0)));
      }
    }
    const delta = new Map<string, number>();
    for (const name of new Set([...cumDay.keys(), ...cumNext.keys()])) {
      delta.set(
        name,
        Math.max(0, (cumDay.get(name) ?? 0) - (cumNext.get(name) ?? 0)),
      );
    }
    if (isStable) await writeDeltaCache(userId, day, delta);
    let sum = 0;
    for (const name of nameSet) sum += delta.get(name) ?? 0;
    return sum;
  } catch (err) {
    console.error(
      `[streaks] getUserHackatimeSecondsForNamesForDay failed for user ${userId} day ${day}:`,
      err,
    );
    return 0;
  }
}

/**
 * Today's hackatime seconds on a project's linked names, for the journal streak gate.
 * Errors return 0 so a hackatime outage doesn't block journal posting.
 */
export async function getProjectHackatimeSecondsToday(
  userId: string,
  projectId: number,
): Promise<number> {
  const [u] = await db
    .select({
      hackatime_oauth_token: users.hackatime_oauth_token,
      hackatime_api_status: users.hackatime_api_status,
      hackatime_id: users.hackatime_id,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u?.hackatime_oauth_token) return 0;
  // Dead/restricted token: skip the doomed calls; the journal gate falls back to journal-only.
  if (u.hackatime_api_status !== "ok") return 0;

  const [p] = await db
    .select({ hackatime_projects: projectTable.hackatime_projects })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  const linkedNames = p?.hackatime_projects ?? [];
  if (!Array.isArray(linkedNames) || linkedNames.length === 0) return 0;

  // users.timezone is kept current by syncHackatimeTimezone on every sync.
  const today = streakDayKey(new Date(), u.timezone);

  // Heartbeats bucket by local midnight; the cumulative OAuth API uses UTC midnight and
  // misjudges this gate near local midnight. Fall back to it when inputs are missing or this fails.
  const adminKey =
    (useRuntimeConfig().hackatimeAdminKey as string | undefined) ?? null;
  if (u.hackatime_id && adminKey && u.timezone) {
    try {
      const { beatsByDay, failedDays } =
        await fetchPerProjectDailyDurationsByLocalDay(
          u.hackatime_id,
          adminKey,
          u.timezone,
          today,
        );
      // Merge wall-clock across this project's names so switching between them isn't double-counted.
      if (!failedDays.has(today)) {
        return mergedDayProjectSeconds(beatsByDay ?? new Map(), today, linkedNames);
      }
    } catch (err) {
      console.error(
        `[streaks] heartbeat project today-seconds failed for project ${projectId}; falling back to cumulative:`,
        err,
      );
    }
  }

  // Buckets at UTC midnight; only used when the heartbeat path is unavailable.
  try {
    const resp = await getAuthenticatedProjects(u.hackatime_oauth_token, {
      startDate: today,
    });
    const linkedSet = new Set(linkedNames);
    let sum = 0;
    for (const hp of resp?.projects ?? []) {
      if (hp?.name && linkedSet.has(hp.name)) {
        sum += Math.max(0, Math.floor(hp.total_seconds ?? 0));
      }
    }
    return sum;
  } catch (err) {
    console.error(
      `[streaks] getProjectHackatimeSecondsToday failed for project ${projectId}:`,
      err,
    );
    return 0;
  }
}

function shiftDay(dayStr: string, deltaDays: number): string {
  const d = new Date(dayStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function maxDay(a: string, b: string): string {
  return a >= b ? a : b;
}

// Hackatime accepts backdated offline heartbeats, so today and yesterday are always re-fetched.
const STREAK_CACHE_STABLE_AGE_DAYS = 2;

function deltaCacheKey(userId: string, day: string): string {
  return `streak:hackatime:proj-delta:${userId}:${day}`;
}

async function readDeltaCache(
  userId: string,
  day: string,
): Promise<Map<string, number> | null> {
  const redis = await getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(deltaCacheKey(userId, day));
    if (!raw) return null;
    return new Map(JSON.parse(raw) as Array<[string, number]>);
  } catch {
    console.warn("[streaks] delta cache read failed");
    return null;
  }
}

async function writeDeltaCache(
  userId: string,
  day: string,
  delta: Map<string, number>,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  try {
    await redis.set(
      deltaCacheKey(userId, day),
      JSON.stringify(Array.from(delta)),
      { EX: 60 * 60 * 24 * 90 }, // 90 days; past-day deltas never change
    );
  } catch {
    console.warn("[streaks] delta cache write failed");
    // Best-effort: cache miss on next sync just re-fetches.
  }
}

/** Lets admin backfill force fresh hackatime data. Best-effort: Redis failures are ignored. */
export async function clearStreakCacheForUser(
  userId: string,
  timezone: string | null,
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  // Keys are local-day; this window also evicts leftover pre-cutover UTC-keyed entries.
  const keys: string[] = [];
  let cursor = streakDayKey(new Date(), timezone);
  for (let i = 0; i < HACKATIME_STREAK_LOOKBACK_DAYS; i++) {
    keys.push(deltaCacheKey(userId, cursor));
    cursor = shiftDay(cursor, -1);
  }
  try {
    if (keys.length > 0) await redis.del(keys);
  } catch {
    console.warn("[streaks] cache clear failed");
  }
}

/**
 * Ship statuses that shield a project's streak from reset paths, so a slow review
 * (or the user's own needs_changes turnaround) doesn't cost them their streak.
 */
export const REVIEW_LOOP_SHIP_STATUSES = [
  "under_review",
  "pending_fraud_review",
  "pending_second_pass",
  "needs_changes",
] as const;

/**
 * Owned project ids with a ship in review. Reads via db, not the caller's tx; the
 * race with the surrounding reset write is rare enough to accept.
 */
export async function getProjectsProtectedByActiveReview(
  userId: string,
): Promise<Set<number>> {
  const rows = await db
    .selectDistinct({ project_id: shipTable.project_id })
    .from(shipTable)
    .where(
      and(
        eq(shipTable.user_id, userId),
        inArray(shipTable.status, REVIEW_LOOP_SHIP_STATUSES),
      ),
    );
  return new Set(rows.map((r) => r.project_id));
}

/**
 * Per-project review-protection input. openOnly keeps only open windows
 * (reviewed_at IS NULL) for backfill; otherwise needs_changes windows capped at
 * reviewed_at are honored too. Team projects are excluded from the work-availability test.
 */
async function loadReviewProtectionProjects(
  userId: string,
  openOnly: boolean,
): Promise<
  Array<{
    createdAt: Date | null;
    isTeam: boolean;
    projectStreakDays: number;
    ships: Array<{
      queue_entered_at: Date | null;
      created_at: Date | null;
      reviewed_at: Date | null;
    }>;
  }>
> {
  const [projectRows, shipRows, teamIds] = await Promise.all([
    db
      .select({
        id: projectTable.id,
        created_at: projectTable.created_at,
        project_streak_days: projectTable.project_streak_days,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.user_id, userId),
          // Soft-deleted rows keep project_streak_days, so they'd pass the
          // "workable alternative" test below and strip review protection.
          isNull(projectTable.deleted_at),
        ),
      ),
    db
      .select({
        project_id: shipTable.project_id,
        queue_entered_at: shipTable.queue_entered_at,
        created_at: shipTable.created_at,
        reviewed_at: shipTable.reviewed_at,
      })
      .from(shipTable)
      .where(
        openOnly
          ? and(
              eq(shipTable.user_id, userId),
              inArray(shipTable.status, REVIEW_LOOP_SHIP_STATUSES),
              isNull(shipTable.reviewed_at),
            )
          : and(
              eq(shipTable.user_id, userId),
              inArray(shipTable.status, REVIEW_LOOP_SHIP_STATUSES),
            ),
      ),
    getTeamProjectIdsOwnedBy(userId),
  ]);

  const shipsByProject = new Map<
    number,
    Array<{
      queue_entered_at: Date | null;
      created_at: Date | null;
      reviewed_at: Date | null;
    }>
  >();
  for (const s of shipRows) {
    const entry = {
      queue_entered_at: s.queue_entered_at,
      created_at: s.created_at,
      reviewed_at: s.reviewed_at,
    };
    const arr = shipsByProject.get(s.project_id);
    if (arr) arr.push(entry);
    else shipsByProject.set(s.project_id, [entry]);
  }

  return projectRows.map((p) => ({
    createdAt: p.created_at,
    isTeam: teamIds.has(p.id),
    projectStreakDays: p.project_streak_days ?? 0,
    ships: shipsByProject.get(p.id) ?? [],
  }));
}

/**
 * Days in [startDay, endDay] (in tz) the reconcile gap walk holds as review_protected
 * (no freeze burned). Only when every solo project that existed that day was itself in
 * review, so one queued ship can't shield idle projects.
 */
export async function getReviewProtectedDaysForUser(
  userId: string,
  tz: string,
  startDay: string,
  endDay: string,
): Promise<Set<string>> {
  if (startDay > endDay) return new Set();
  return computeWorkAvailableReviewProtectedDays({
    projects: await loadReviewProtectionProjects(userId, false),
    tz,
    startDay,
    endDay,
  });
}

/**
 * Open windows only (reviewed_at IS NULL), for the backfill sweep: these strand days
 * when a ship enters review after the day already had a row. needs_changes windows are
 * already capped at reviewed_at by reconcile.
 */
async function getOpenReviewProtectedDaysForUser(
  userId: string,
  tz: string,
  startDay: string,
  endDay: string,
): Promise<Set<string>> {
  if (startDay > endDay) return new Set();
  return computeWorkAvailableReviewProtectedDays({
    projects: await loadReviewProtectionProjects(userId, true),
    tz,
    startDay,
    endDay,
  });
}

export interface ReviewProtectionBackfillResult {
  protectedDays: string[];
  // Of those, days that were `frozen` and returned a freeze.
  refundedFreezes: number;
  // Eligible (pending/missed/frozen) days examined.
  checked: number;
}

/**
 * Heals pending/missed/frozen days inside an open review window to review_protected.
 * They strand because the row predates the ship entering review and neither the gap-walk
 * nor the nightly recompute revisits them. Frozen days get their freeze back (capped).
 */
export async function backfillReviewProtectionGaps(
  userId: string,
  opts?: { actorId?: string; dryRun?: boolean; lookbackDays?: number },
): Promise<ReviewProtectionBackfillResult> {
  const actorId = opts?.actorId ?? userId;
  const empty: ReviewProtectionBackfillResult = {
    protectedDays: [],
    refundedFreezes: 0,
    checked: 0,
  };

  const [u] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return empty;

  const today = streakDayKey(new Date(), u.timezone);

  const protectedSet = await getOpenReviewProtectedDaysForUser(
    userId,
    u.timezone ?? "UTC",
    shiftDay(today, -(opts?.lookbackDays ?? 60)), // default lookback days
    yesterdayStr(today),
  );
  if (protectedSet.size === 0) return empty;

  const rows = await db
    .select({ day: streakDaysTable.day, status: streakDaysTable.status })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        inArray(streakDaysTable.day, [...protectedSet]),
        inArray(streakDaysTable.status, ["pending", "missed", "frozen"]),
      ),
    );
  if (rows.length === 0) return empty;

  const plan = planReviewProtectionBackfill({
    protectedDays: protectedSet,
    statusByDay: new Map(rows.map((r) => [r.day, r.status])),
  });
  if (plan.length === 0) return empty;

  const result: ReviewProtectionBackfillResult = {
    protectedDays: [],
    refundedFreezes: 0,
    checked: plan.length,
  };
  if (opts?.dryRun) {
    result.protectedDays = plan.map((p) => p.day);
    result.refundedFreezes = plan.filter((p) => p.refundFreeze).length;
    return result;
  }

  for (const item of plan) {
    const applied = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ status: streakDaysTable.status })
        .from(streakDaysTable)
        .where(
          and(
            eq(streakDaysTable.user_id, userId),
            eq(streakDaysTable.day, item.day),
          ),
        )
        .for("update")
        .limit(1);
      if (existing?.status !== item.from) return false;

      let oldFreezes: number | null = null;
      let newFreezes: number | null = null;
      if (item.refundFreeze) {
        const [su] = await tx
          .select({ streak_freezes_remaining: users.streak_freezes_remaining })
          .from(users)
          .where(eq(users.id, userId))
          .for("update")
          .limit(1);
        if (su) {
          oldFreezes = su.streak_freezes_remaining;
          newFreezes = Math.min(MAX_STREAK_FREEZES, oldFreezes + 1);
          if (newFreezes !== oldFreezes) {
            await tx
              .update(users)
              .set({ streak_freezes_remaining: newFreezes })
              .where(eq(users.id, userId));
          }
        }
      }

      await tx
        .update(streakDaysTable)
        .set({ status: "review_protected", updated_at: new Date() })
        .where(
          and(
            eq(streakDaysTable.user_id, userId),
            eq(streakDaysTable.day, item.day),
          ),
        );

      await tx.insert(auditLogTable).values({
        actor_id: actorId,
        action: "streak_day_review_protected_backfill",
        entity_type: "user",
        entity_id: userId,
        old_value: {
          day: item.day,
          status: item.from,
          ...(item.refundFreeze ? { freezes: oldFreezes } : {}),
        },
        new_value: {
          day: item.day,
          status: "review_protected",
          ...(item.refundFreeze ? { freezes: newFreezes, refunded: newFreezes !== oldFreezes } : {}),
          reason: "day inside an open review window (ship in queue, reviewed_at null) was stranded; review-protection backfilled",
          source: "open_review_backfill",
        },
        sensitive: false,
        public_message: item.refundFreeze
          ? `Restored review-protection for ${item.day} and refunded the freeze (ship was in review that day).`
          : `Restored review-protection for ${item.day} (ship was in review that day).`,
        change_summary: "streak_day_review_protected_backfill",
      });
      return { refunded: item.refundFreeze && newFreezes !== oldFreezes };
    });

    if (applied) {
      result.protectedDays.push(item.day);
      if (applied.refunded) result.refundedFreezes += 1;
    }
  }

  if (result.protectedDays.length > 0) {
    await clearStreakCacheForUser(userId, u.timezone);
  }
  return result;
}

export interface StrandedFreezeBackfillResult {
  frozenDays: string[];
  // equals frozenDays.length on success
  freezesConsumed: number;
  // Left pending (no freeze or opted out); never auto-marked missed, since that
  // high-risk reset belongs to the gap-walk.
  unresolvedNoFreeze: string[];
  checked: number;
}

/**
 * Freezes pending holes stranded when a requalifying day moved last_active_date past
 * them, as the gap-walk would have. All-or-nothing and only inside the current run (kept
 * day on both sides); never touches today or last_active_date, never marks days missed.
 */
export async function backfillStrandedPendingFreezes(
  userId: string,
  opts?: {
    actorId?: string;
    dryRun?: boolean;
    lookbackDays?: number;
    // comp: bridge as frozen without spending a freeze (goodwill for the backlog our
    // reconcile bug caused); the set of healed holes is the same either way.
    comp?: boolean;
  },
): Promise<StrandedFreezeBackfillResult> {
  const comp = opts?.comp ?? false;
  const actorId = opts?.actorId ?? userId;
  const empty: StrandedFreezeBackfillResult = {
    frozenDays: [],
    freezesConsumed: 0,
    unresolvedNoFreeze: [],
    checked: 0,
  };

  const [u] = await db
    .select({
      timezone: users.timezone,
      streak_freezes_remaining: users.streak_freezes_remaining,
      auto_use_streak_freezes: users.auto_use_streak_freezes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return empty;

  const today = streakDayKey(new Date(), u.timezone);
  const startDay = shiftDay(today, -(opts?.lookbackDays ?? 60)); // default lookback days

  // Includes today so a requalification that landed today counts as the later kept day.
  const rows = await db
    .select({ day: streakDaysTable.day, status: streakDaysTable.status })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        between(streakDaysTable.day, startDay, today),
      ),
    );
  if (rows.length === 0) return empty;
  const statusByDay = new Map<string, string>(
    rows.map((r) => [r.day, r.status]),
  );

  // Open review days are healed by backfillReviewProtectionGaps; treat them as kept so
  // they bridge holes but are never charged a freeze.
  const openReviewDays = await getOpenReviewProtectedDaysForUser(
    userId,
    u.timezone ?? "UTC",
    startDay,
    yesterdayStr(today),
  );
  for (const d of openReviewDays) {
    if (statusByDay.get(d) === "pending") {
      statusByDay.set(d, "review_protected");
    }
  }

  // A burn only helps when auto-freeze is on and an opted-in project has a live streak
  // not already held by review (mirrors the gap-walk's gate).
  const userProjects = await db
    .select({
      id: projectTable.id,
      auto_use_streak_freezes: projectTable.auto_use_streak_freezes,
      project_streak_days: projectTable.project_streak_days,
      created_at: projectTable.created_at,
      deleted_at: projectTable.deleted_at,
    })
    .from(projectTable)
    .where(eq(projectTable.user_id, userId));
  // No projects: pending rows are pure hackatime backfill, not unresolved holes.
  if (userProjects.length === 0) return empty;
  const reviewProtectedProjectIds =
    await getProjectsProtectedByActiveReview(userId);
  const canBurn =
    !!u.auto_use_streak_freezes &&
    hasProtectableProjectStreak(userProjects, reviewProtectedProjectIds);

  // Holes before the oldest project are backfilled pre-project history with no plant to
  // protect, so they must never be bridged.
  let earliestPlantDay: string | null = null;
  for (const p of userProjects) {
    const day = streakDayKey(p.created_at ?? new Date(), u.timezone);
    if (earliestPlantDay === null || day < earliestPlantDay) {
      earliestPlantDay = day;
    }
  }

  const plan = planStrandedFreezeBackfill({
    statusByDay,
    today,
    freezesAvailable: u.streak_freezes_remaining,
    canBurn,
    earliestPlantDay,
  });
  const checked = plan.freezeDays.length + plan.unresolvedNoFreeze.length;
  if (checked === 0) return empty;

  if (opts?.dryRun) {
    return {
      frozenDays: plan.freezeDays,
      freezesConsumed: comp ? 0 : plan.freezeDays.length,
      unresolvedNoFreeze: plan.unresolvedNoFreeze,
      checked,
    };
  }

  if (plan.freezeDays.length === 0) {
    return {
      frozenDays: [],
      freezesConsumed: 0,
      unresolvedNoFreeze: plan.unresolvedNoFreeze,
      checked,
    };
  }

  // One transaction keeps the all-or-nothing contract under a concurrent freeze spend.
  const applied = await db.transaction(async (tx) => {
    const [su] = await tx
      .select({ streak_freezes_remaining: users.streak_freezes_remaining })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    if (!su) return null;

    // A protectable project streak may have lapsed since the pre-tx read.
    const [activeProject] = await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.user_id, userId),
          isNull(projectTable.deleted_at),
          eq(projectTable.auto_use_streak_freezes, true),
          gte(projectTable.project_streak_days, 1),
        ),
      )
      .limit(1);
    if (!activeProject) return null;

    const stillPending: string[] = [];
    for (const day of plan.freezeDays) {
      const [r] = await tx
        .select({ status: streakDaysTable.status })
        .from(streakDaysTable)
        .where(
          and(
            eq(streakDaysTable.user_id, userId),
            eq(streakDaysTable.day, day),
          ),
        )
        .for("update")
        .limit(1);
      // A day raced to missed means the run broke, so bail; other kept statuses are skipped.
      if (r?.status === "missed") return null;
      if (r?.status === "pending") stillPending.push(day);
    }
    if (stillPending.length === 0) {
      return { frozen: [] as string[], before: su.streak_freezes_remaining, after: su.streak_freezes_remaining };
    }
    const before = su.streak_freezes_remaining;
    // comp mode is net-zero, so the balance only matters for real burns.
    if (!comp && before < stillPending.length) return null; // lost freezes since planning

    const after = comp ? before : before - stillPending.length;
    if (!comp) {
      await tx
        .update(users)
        .set({ streak_freezes_remaining: after })
        .where(eq(users.id, userId));
    }
    for (const day of stillPending) {
      await tx
        .update(streakDaysTable)
        .set({ status: "frozen", updated_at: new Date() })
        .where(
          and(
            eq(streakDaysTable.user_id, userId),
            eq(streakDaysTable.day, day),
          ),
        );
    }
    await tx.insert(auditLogTable).values({
      actor_id: actorId,
      action: "streak_freeze_backfill_stranded",
      entity_type: "user",
      entity_id: userId,
      old_value: { freezes: before, days: stillPending, prior_status: "pending" },
      new_value: {
        freezes: after,
        frozen_days: stillPending,
        comp,
        reason: comp
          ? "Reconcile gap-walk stranded these near-miss days as pending (the user requalified the next day, advancing last_active past them). Bridged with a net-zero goodwill comp (no freeze charged) since the stranding was our bug; historical backlog remediation."
          : "Reconcile gap-walk stranded these near-miss days as pending (the user requalified the next day, advancing last_active past them). Bridged with a freeze, matching what the gap-walk would have done at the time.",
      },
      sensitive: false,
      public_message: comp
        ? stillPending.length === 1
          ? `Recovered ${stillPending[0]} (a day the reconcile skipped); no streak freeze charged.`
          : `Recovered ${stillPending.join(", ")} (days the reconcile skipped); no streak freezes charged.`
        : stillPending.length === 1
          ? `Used 1 streak freeze to protect ${stillPending[0]} (recovered a day the reconcile skipped).`
          : `Used ${stillPending.length} streak freezes to protect ${stillPending.join(", ")} (recovered days the reconcile skipped).`,
      change_summary: "streak_freeze_backfill_stranded",
    });
    return { frozen: stillPending, before, after };
  });

  if (!applied) {
    // Raced (run broke or freezes spent); report the holes as unresolved.
    return {
      frozenDays: [],
      freezesConsumed: 0,
      unresolvedNoFreeze: plan.freezeDays.concat(plan.unresolvedNoFreeze),
      checked,
    };
  }

  if (applied.frozen.length > 0) {
    await clearStreakCacheForUser(userId, u.timezone);
  }
  return {
    frozenDays: applied.frozen,
    freezesConsumed: applied.before - applied.after,
    unresolvedNoFreeze: plan.unresolvedNoFreeze,
    checked,
  };
}

/**
 * Clean-slate step for admin streak backfill (with clearStreakCacheForUser +
 * extendProjectStreaksFromHackatime). Projects in review are skipped so their
 * protected streak isn't cleared.
 */
export async function resetUserProjectStreaks(userId: string): Promise<number> {
  const linked = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.user_id, userId),
        isNotNull(projectTable.hackatime_projects),
      ),
    );
  if (linked.length === 0) return 0;
  const protectedIds = await getProjectsProtectedByActiveReview(userId);
  const resettableIds = linked
    .map((p) => p.id)
    .filter((id) => !protectedIds.has(id));
  if (resettableIds.length === 0) return 0;
  await db
    .update(projectTable)
    .set({
      project_streak_days: 0,
      last_worked_date: null,
      stage: 1,
      updated_at: new Date(),
    })
    .where(
      and(
        eq(projectTable.user_id, userId),
        isNotNull(projectTable.hackatime_projects),
        inArray(projectTable.id, resettableIds),
      ),
    );
  return resettableIds.length;
}

export interface PerProjectDailyResult {
  // day -> projectName -> seconds
  perDay: Map<string, Map<string, number>>;
  // Heartbeat path only. Multi-project callers must merge these beats and gap-sum once;
  // summing perDay double-counts switches inside the heartbeat timeout.
  beatsByDay?: Map<string, Map<string, RawHeartbeat[]>>;
  failedDays: Set<string>;
}

/**
 * Per-day, per-project seconds via delta[d] = cumSince(d) - cumSince(d+1). Stable past
 * days come from Redis; failed days are reported so an outage doesn't zero a streak.
 */
export async function fetchPerProjectDailyDurations(
  userId: string,
  accessToken: string,
  // Ignored since the UTC re-anchor; kept to avoid churning the call graph.
  _timezone: string | null,
  startDay: string,
): Promise<PerProjectDailyResult> {
  // UTC today matches Hackatime's start_date interpretation.
  const today = streakDayKey();
  const days: string[] = [];
  let cursor = startDay;
  while (cursor <= today) {
    days.push(cursor);
    cursor = shiftDay(cursor, 1);
  }

  const perDay = new Map<string, Map<string, number>>();
  await Promise.all(
    days.map(async (day) => {
      if (daysBetween(day, today) >= STREAK_CACHE_STABLE_AGE_DAYS) {
        const cached = await readDeltaCache(userId, day);
        if (cached) perDay.set(day, cached);
      }
    }),
  );

  const needCumSince = new Set<string>();
  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if (perDay.has(d)) continue;
    needCumSince.add(d);
    if (i + 1 < days.length) needCumSince.add(days[i + 1]!);
  }

  // Parallel keeps fetch times close enough that the subtraction is stable.
  const cumulative = new Map<string, Map<string, number>>();
  const failedDays = new Set<string>();
  await Promise.all(
    Array.from(needCumSince).map(async (day) => {
      try {
        const resp = await getAuthenticatedProjects(accessToken, {
          startDate: day,
        });
        const projectMap = new Map<string, number>();
        for (const hp of resp?.projects ?? []) {
          if (hp?.name) {
            projectMap.set(
              hp.name,
              Math.max(0, Math.floor(hp.total_seconds ?? 0)),
            );
          }
        }
        cumulative.set(day, projectMap);
      } catch (err) {
        console.error(
          `[streaks] per-project cumSince fetch failed for ${day}:`,
          err,
        );
        failedDays.add(day);
      }
    }),
  );

  for (let i = 0; i < days.length; i++) {
    const d = days[i]!;
    if (perDay.has(d)) continue;

    const cumD = cumulative.get(d);
    const cumDPlus1 =
      i + 1 < days.length ? cumulative.get(days[i + 1]!) : new Map();

    // Missing cumSince(d) leaves the delta unknown (already in failedDays); a missing
    // d+1 at the window end counts as 0.
    if (!cumD) {
      continue;
    }

    const delta = new Map<string, number>();
    for (const name of new Set<string>([
      ...cumD.keys(),
      ...(cumDPlus1?.keys() ?? []),
    ])) {
      delta.set(
        name,
        Math.max(0, (cumD.get(name) ?? 0) - (cumDPlus1?.get(name) ?? 0)),
      );
    }
    perDay.set(d, delta);

    if (daysBetween(d, today) >= STREAK_CACHE_STABLE_AGE_DAYS) {
      await writeDeltaCache(userId, d, delta);
    }
  }

  return { perDay, failedDays };
}

// The cumulative OAuth API buckets at UTC midnight, which doesn't match a user-local day
// key. Raw heartbeats over a UTC window padded a day each side are re-bucketed by dayInTz;
// the gap-sum mirrors ship-submit-time-hours.ts:durationSecondsForProjects.

const MAX_HEARTBEATS_PER_USER_PER_SYNC = 50_000;

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

type RawHeartbeat = { time: number; project: string | null };

async function fetchHeartbeatPage(
  adminKey: string,
  url: string,
  hackatimeId: number,
): Promise<{ heartbeats?: RawHeartbeat[]; has_more?: boolean }> {
  const get = (acceptEncoding: string) =>
    fetch(url, {
      headers: {
        Authorization: `Bearer ${adminKey}`,
        Accept: "application/json",
        "Accept-Encoding": acceptEncoding,
      },
    });

  // Node 22's undici truncates zstd bodies over 32 KiB, breaking large heartbeat pages;
  // asking for gzip/deflate/br explicitly keeps the server from choosing zstd.
  let res = await get("gzip, deflate, br");
  if (!res.ok) {
    throw new Error(
      `hackatime admin /user/heartbeats returned ${res.status} ${res.statusText} for hackatime_id=${hackatimeId}`,
    );
  }
  // Parse text ourselves so a decompression truncation is a recoverable, described error.
  let body = await res.text();
  try {
    return JSON.parse(body) as { heartbeats?: RawHeartbeat[]; has_more?: boolean };
  } catch (err) {
    // Retry uncompressed: identity can't hit a decompressor bug, so a second parse
    // failure is a genuinely bad body and propagates.
    console.warn(
      `[streaks] heartbeat page parse failed for hackatime_id=${hackatimeId} ` +
        `(${body.length} bytes: ${err instanceof Error ? err.message : String(err)}); ` +
        `retrying uncompressed`,
    );
    res = await get("identity");
    if (!res.ok) {
      throw new Error(
        `hackatime admin /user/heartbeats retry returned ${res.status} ${res.statusText} for hackatime_id=${hackatimeId}`,
      );
    }
    body = await res.text();
    return JSON.parse(body) as { heartbeats?: RawHeartbeat[]; has_more?: boolean };
  }
}

async function fetchHeartbeatsInWindow(
  adminKey: string,
  hackatimeId: number,
  startSeconds: number,
  endSeconds: number,
): Promise<{ beats: RawHeartbeat[]; truncated: boolean }> {
  const out: RawHeartbeat[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore && out.length < MAX_HEARTBEATS_PER_USER_PER_SYNC) {
    const data = await fetchHeartbeatPage(
      adminKey,
      `${HACKATIME_ADMIN_API_URL}/user/heartbeats` +
        `?id=${hackatimeId}` +
        `&start_date=${startSeconds}` +
        `&end_date=${endSeconds}` +
        `&limit=5000` + // heartbeats per page
        `&offset=${offset}`,
      hackatimeId,
    );
    const batch = data.heartbeats ?? [];
    out.push(...batch);
    hasMore = data.has_more === true;
    // Advance by the actual batch size in case upstream returns a short page with has_more;
    // break on empty so an upstream that lies about has_more can't loop forever.
    if (batch.length === 0) break;
    offset += batch.length;
    if (hasMore) await sleep(100);
  }
  // Paging is oldest-first, so truncation loses the newest days; the caller routes those
  // to the uncapped cumulative path instead of reading them as zero work.
  return {
    beats: out,
    truncated: hasMore && out.length >= MAX_HEARTBEATS_PER_USER_PER_SYNC,
  };
}

/**
 * Heartbeat-based fetchPerProjectDailyDurations, bucketed by local day in tz. On any
 * failure every day in the window goes to failedDays so the caller skips the write.
 */
export async function fetchPerProjectDailyDurationsByLocalDay(
  hackatimeId: number,
  adminKey: string,
  tz: string,
  startDay: string,
): Promise<PerProjectDailyResult> {
  const todayLocal = streakDayKey(new Date(), tz);

  const allDays: string[] = [];
  let cursor = startDay;
  while (cursor <= todayLocal) {
    allDays.push(cursor);
    cursor = shiftDay(cursor, 1);
  }

  // Fetch in day-chunks: one wide fetch paginates oldest-first and hits the beat cap,
  // dropping the most recent days for heavy users. Each chunk's UTC range is padded a
  // day each side for any IANA offset; overlaps only yield duplicate beats (zero gap).
  const beats: RawHeartbeat[] = [];
  let truncated = false;
  let chunkStart = startDay;
  let firstChunk = true;
  while (chunkStart <= todayLocal) {
    let chunkEnd = shiftDay(chunkStart, 4 - 1); // 4-day chunks stay under the beat cap
    if (chunkEnd > todayLocal) chunkEnd = todayLocal;
    const cs = new Date(chunkStart + "T00:00:00Z");
    cs.setUTCDate(cs.getUTCDate() - 1);
    const ce = new Date(chunkEnd + "T00:00:00Z");
    ce.setUTCDate(ce.getUTCDate() + 2);
    if (!firstChunk) await sleep(200);
    firstChunk = false;
    try {
      const fetched = await fetchHeartbeatsInWindow(
        adminKey,
        hackatimeId,
        Math.floor(cs.getTime() / 1000), // ms to unix seconds
        Math.floor(ce.getTime() / 1000),
      );
      beats.push(...fetched.beats);
      if (fetched.truncated) truncated = true;
    } catch (err) {
      console.error(
        `[streaks] heartbeat chunk fetch failed for hackatime_id=${hackatimeId} (${chunkStart}..${chunkEnd}); flagging entire local-day window as failed:`,
        err,
      );
      return {
        perDay: new Map(),
        beatsByDay: new Map(),
        failedDays: new Set(allDays),
      };
    }
    chunkStart = shiftDay(chunkEnd, 1);
  }

  // Null-project beats can't be honestly attributed, so drop them. newestCoveredDay lets
  // a truncated fetch flag the later days as unreliable.
  const beatsByDayProject = new Map<string, Map<string, RawHeartbeat[]>>();
  let newestCoveredDay: string | null = null;
  for (const b of beats) {
    if (b.project == null) continue;
    const ms = b.time * 1000; // unix seconds to ms
    if (!Number.isFinite(ms)) continue;
    const localDay = dayInTz(new Date(ms), tz);
    if (localDay < startDay || localDay > todayLocal) continue;
    if (newestCoveredDay === null || localDay > newestCoveredDay) {
      newestCoveredDay = localDay;
    }
    let dayMap = beatsByDayProject.get(localDay);
    if (!dayMap) {
      dayMap = new Map<string, RawHeartbeat[]>();
      beatsByDayProject.set(localDay, dayMap);
    }
    let arr = dayMap.get(b.project);
    if (!arr) {
      arr = [];
      dayMap.set(b.project, arr);
    }
    arr.push(b);
  }

  // Hackatime's own duration rule (per project, each gap capped at the timeout), so these
  // buckets match the per-project numbers Hackatime shows.
  const perDay = new Map<string, Map<string, number>>();
  for (const [day, dayMap] of beatsByDayProject) {
    const projMap = new Map<string, number>();
    for (const [project, projBeats] of dayMap) {
      projBeats.sort((a, b) => a.time - b.time);
      let total = 0;
      for (let i = 1; i < projBeats.length; i++) {
        const gap = projBeats[i]!.time - projBeats[i - 1]!.time;
        if (gap > 0) total += Math.min(gap, HACKATIME_HEARTBEAT_TIMEOUT_SECONDS);
      }
      if (total > 0) projMap.set(project, Math.round(total));
    }
    if (projMap.size > 0) perDay.set(day, projMap);
  }

  // A truncated fetch only covers the oldest days; flag the rest so the caller falls back
  // to the cumulative path instead of treating them as zero work.
  const failedDays = new Set<string>();
  if (truncated) {
    const unreliable = unreliableDaysAfterTruncation({
      truncated,
      allDays,
      newestCoveredDay,
    });
    for (const d of unreliable) failedDays.add(d);
    console.warn(
      `[streaks] heartbeat fetch truncated at the ${MAX_HEARTBEATS_PER_USER_PER_SYNC}-beat cap for hackatime_id=${hackatimeId}; flagging ${unreliable.length} day(s) at/after ${newestCoveredDay ?? "(no in-window beats)"} as unreliable so the cumulative fallback covers them`,
    );
  }

  return { perDay, beatsByDay: beatsByDayProject, failedDays };
}

/** Empty or missing maps return 0, so callers can call this for any day in the window. */
function sumDayProjectSeconds(
  perDay: Map<string, Map<string, number>>,
  day: string,
  names: string[],
): number {
  const dayMap = perDay.get(day);
  if (!dayMap || names.length === 0) return 0;
  // Dedupe so a name repeated in a pre-dedup row can't count N times.
  let sum = 0;
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    sum += dayMap.get(name) ?? 0;
  }
  return sum;
}

/**
 * Wall-clock seconds across a name set on one local day: merge their beats and gap-sum
 * once, so cross-project switches aren't double-counted like in sumDayProjectSeconds.
 */
function mergedDayProjectSeconds(
  beatsByDay: Map<string, Map<string, RawHeartbeat[]>>,
  day: string,
  names: string[],
): number {
  const dayMap = beatsByDay.get(day);
  if (!dayMap || names.length === 0) return 0;
  const merged: RawHeartbeat[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const arr = dayMap.get(name);
    if (arr) merged.push(...arr);
  }
  return mergedGapSumSeconds(merged);
}

/**
 * Prefers merged heartbeats. The per-project sum fallback (cumulative path) doesn't
 * double-count since Hackatime already attributes each second to one project.
 */
export function dayProjectSeconds(
  beatsByDay: Map<string, Map<string, RawHeartbeat[]>> | null | undefined,
  perDay: Map<string, Map<string, number>>,
  day: string,
  names: string[],
): number {
  if (beatsByDay && beatsByDay.has(day)) {
    return mergedDayProjectSeconds(beatsByDay, day, names);
  }
  return sumDayProjectSeconds(perDay, day, names);
}

// Fast first retry catches blips, then back off; after these the next regular sync retries.
const STREAK_RETRY_BACKOFFS_MS = [60_000, 180_000, 600_000];

// Namespace (first int of the two-arg advisory lock) so it can't collide with other lock spaces.
const STREAK_LOCK_NAMESPACE = 0x57_72_61_6b; // ASCII "Wrak"

function streakLockKey(userId: string): number {
  // This hashes a user ID into a Postgres lock number, not a password.
  // Preserve the mapping so overlapping deployments acquire the same lock.
  // Postgres int4 is signed and takes the full range, so no need to clamp the high bit.
  return createHash("sha256").update("streaks:" + userId).digest().readInt32BE(0);
}

// Coalesces retries per user so failed syncs don't pile up timers. Lost on restart, which
// is fine: the next sync and the delta cache pick up.
const pendingStreakRetries = new Map<string, NodeJS.Timeout>();

function scheduleStreakRetry(
  userId: string,
  accessToken: string,
  timezone: string | null,
  attempt: number,
): void {
  if (attempt >= STREAK_RETRY_BACKOFFS_MS.length) {
    console.warn(
      `[streaks] giving up after ${attempt} in-process retries; next regular sync will reattempt`,
    );
    return;
  }
  const key = `streak-retry:${userId}`;
  const existing = pendingStreakRetries.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(async () => {
    pendingStreakRetries.delete(key);
    try {
      await extendProjectStreaksFromHackatime(
        userId,
        accessToken,
        timezone,
        attempt + 1,
      );
    } catch {
      console.error(
        `[streaks] retry attempt ${attempt + 1} threw`,
      );
    }
  }, STREAK_RETRY_BACKOFFS_MS[attempt]!);
  // Don't keep the node process alive just for a retry timer.
  if (typeof timer.unref === "function") timer.unref();
  pendingStreakRetries.set(key, timer);
}

/**
 * Recomputes project streaks from per-day hackatime data. Each hackatime name credits only
 * the earliest-created lynx project, so one set of hours can't multiply streaks. If today's
 * or yesterday's data fails, the stored streak is kept and a retry is scheduled.
 */
export async function extendProjectStreaksFromHackatime(
  userId: string,
  accessToken: string,
  timezone: string | null,
  attempt: number = 0,
): Promise<{ extended: number[] }> {
  const today = streakDayKey(new Date(), timezone);
  const yesterday = shiftDay(today, -1);

  // Without hackatime_id + admin key, fall back to the UTC-bucketed cumulative path; a
  // sub-day offset error beats refusing the recompute.
  const [userRow] = await db
    .select({
      hackatime_id: users.hackatime_id,
      hackatime_api_status: users.hackatime_api_status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // Dead/restricted token: half-updating a frozen user is inconsistent and the OAuth fallback
  // + retries amplified 401 floods. The next healthy sync walks the whole window.
  if (userRow && userRow.hackatime_api_status !== "ok") {
    return { extended: [] };
  }
  const hackatimeId = userRow?.hackatime_id ?? null;
  const config = useRuntimeConfig();
  const adminKey = (config.hackatimeAdminKey as string | undefined) ?? null;
  const canUseHeartbeats = !!hackatimeId && !!adminKey && !!timezone;

  const linked = (
    await db
      .select({
        id: projectTable.id,
        project_streak_days: projectTable.project_streak_days,
        last_worked_date: projectTable.last_worked_date,
        hackatime_projects: projectTable.hackatime_projects,
        created_at: projectTable.created_at,
        auto_use_streak_freezes: projectTable.auto_use_streak_freezes,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.user_id, userId),
          isNotNull(projectTable.hackatime_projects),
          // Soft-deleted projects keep hackatime_projects and would starve their live
          // replacement in the earliest-claim dedupe.
          isNull(projectTable.deleted_at),
        ),
      )
  ).filter(
    (p) => Array.isArray(p.hackatime_projects) && p.hackatime_projects.length > 0,
  );
  // Collaborated team names feed the user-level backfill at the end, so a pure
  // collaborator must still get past the early return.
  const collaboratorNames = await getActiveCollaboratorHackatimeNames(userId);
  if (linked.length === 0 && collaboratorNames.length === 0) {
    return { extended: [] };
  }

  // Team projects are recomputed per team (this path only has one member's hackatime), so
  // the walk skips them; they stay in linked so their names feed the user-level backfill.
  const teamOwnedIds = await getTeamProjectIdsOwnedBy(userId);

  // Capped at the lookback so the API call set stays bounded; each project is further
  // floored at its creation date in the walk.
  const windowStart = maxDay(
    MACONDO_STREAK_START_DATE,
    shiftDay(today, -(HACKATIME_STREAK_LOOKBACK_DAYS - 1)),
  );

  let { perDay, beatsByDay, failedDays } = canUseHeartbeats
    ? await fetchPerProjectDailyDurationsByLocalDay(
        hackatimeId!,
        adminKey!,
        timezone!,
        windowStart,
      )
    : await fetchPerProjectDailyDurations(
        userId,
        accessToken,
        timezone,
        windowStart,
      );

  // The admin heartbeat endpoint can fail for one user while OAuth is healthy; fall back
  // to the UTC-bucketed cumulative path rather than freeze their streak.
  let usedHeartbeatFallback = false;
  if (
    canUseHeartbeats
    && (failedDays.has(today) || failedDays.has(yesterday))
  ) {
    console.warn(
      "[streaks] heartbeat fetch failed; falling back to cumulative path",
    );
    const fallback = await fetchPerProjectDailyDurations(
      userId,
      accessToken,
      timezone,
      windowStart,
    );
    perDay = fallback.perDay;
    // No raw beats here; the per-project sum is correct since Hackatime attributes each
    // second to one project.
    beatsByDay = undefined;
    failedDays = fallback.failedDays;
    usedHeartbeatFallback = true;
  }

  // Unknown today/yesterday isn't trustworthy: keep the stored streak and retry. Past-day
  // failures just contribute 0 and self-correct on the next sync.
  const todayUnknown = failedDays.has(today);
  const yesterdayUnknown = failedDays.has(yesterday);
  if (todayUnknown || yesterdayUnknown) {
    console.warn(
      `[streaks] hackatime fetch incomplete (attempt ${attempt + 1}); scheduling retry`,
    );
    scheduleStreakRetry(userId, accessToken, timezone, attempt);
    return { extended: [] };
  }

  // Each hackatime name credits only the earliest-created lynx project; the cache keeps full
  // per-project data, so deleting the older one recovers in one sync.
  const effectiveNamesByProject = effectiveHackatimeNamesByProject(linked);

  // Journal seconds per (project, day), so a journal on project A never credits project B.
  // Re-derived from journals every sync, so archived journals simply drop out.
  const linkedIds = linked.map((p) => p.id);
  const journalRows = linkedIds.length === 0
    ? []
    : await db
        .select({
          project_id: journalsTable.project_id,
          created_at: journalsTable.created_at,
          hours: journalsTable.hours,
        })
        .from(journalsTable)
        .where(
          and(
            inArray(journalsTable.project_id, linkedIds),
            isNotNull(journalsTable.created_at),
            eq(journalsTable.archived, false),
          ),
        );
  const journalSecondsByProjectDay = new Map<number, Map<string, number>>();
  for (const j of journalRows) {
    if (!j.created_at) continue;
    const day = streakDayKey(j.created_at, timezone);
    const seconds = hoursToSeconds(j.hours);
    if (seconds <= 0) continue;
    let dayMap = journalSecondsByProjectDay.get(j.project_id);
    if (!dayMap) {
      dayMap = new Map<string, number>();
      journalSecondsByProjectDay.set(j.project_id, dayMap);
    }
    dayMap.set(day, (dayMap.get(day) ?? 0) + seconds);
  }

  // Stored DPA hackatime is a monotonic high-water mark; using it as a floor stops
  // downward drift in cumulative totals from stripping previously earned days.
  const dpaRows = linkedIds.length === 0
    ? []
    : await db
        .select({
          project_id: dailyProjectActivityTable.project_id,
          day: dailyProjectActivityTable.day,
          hackatime_seconds: dailyProjectActivityTable.hackatime_seconds,
        })
        .from(dailyProjectActivityTable)
        .where(
          and(
            eq(dailyProjectActivityTable.user_id, userId),
            inArray(dailyProjectActivityTable.project_id, linkedIds),
          ),
        );
  const storedHackatimeByProject = new Map<number, Map<string, number>>();
  for (const r of dpaRows) {
    let m = storedHackatimeByProject.get(r.project_id);
    if (!m) {
      m = new Map<string, number>();
      storedHackatimeByProject.set(r.project_id, m);
    }
    m.set(r.day, r.hackatime_seconds);
  }

  // Per-name link floor: a first link pins to project creation, a re-link to now(),
  // closing the unlink+relink double-backfill exploit.
  const linkedAtByProjectName = new Map<number, Map<string, string>>();
  if (linkedIds.length > 0) {
    const linkRows = await db
      .select({
        project_id: projectHackatimeLinksTable.project_id,
        hackatime_name: projectHackatimeLinksTable.hackatime_name,
        linked_at: projectHackatimeLinksTable.linked_at,
      })
      .from(projectHackatimeLinksTable)
      .where(
        and(
          inArray(projectHackatimeLinksTable.project_id, linkedIds),
          eq(projectHackatimeLinksTable.is_active, true),
        ),
      );
    for (const r of linkRows) {
      let m = linkedAtByProjectName.get(r.project_id);
      if (!m) {
        m = new Map<string, string>();
        linkedAtByProjectName.set(r.project_id, m);
      }
      m.set(r.hackatime_name, streakDayKey(r.linked_at, timezone));
    }
  }

  // Bound the recount at the last missed day so a project reconcile just reset can't be
  // rebuilt across the break from historical days.
  const [missedAgg] = await db
    .select({ lastMissed: sql<string | null>`max(${streakDaysTable.day})` })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        eq(streakDaysTable.status, "missed"),
      ),
    );
  const lastMissedDay = missedAgg?.lastMissed ?? null;

  // Frozen days count toward auto-freeze projects with a running streak; otherwise the
  // plant falls a day behind the headline for every freeze.
  const statusRows = await db
    .select({
      day: streakDaysTable.day,
      status: streakDaysTable.status,
    })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        between(streakDaysTable.day, windowStart, today),
      ),
    );
  const userStatusByDay = new Map(statusRows.map((r) => [r.day, r.status]));

  // Hold an opted-out plant whose ship is still in review at its stored streak; the
  // review_protected day bridge lapses once the maker works a different project.
  const reviewProtectedProjectIds =
    await getProjectsProtectedByActiveReview(userId);

  // All ships, terminal included: bridging each review-queue window keeps a decision from
  // retroactively turning the queue wait into an idle gap.
  const reviewBridgeShipRows = linkedIds.length === 0
    ? []
    : await db
        .select({
          project_id: shipTable.project_id,
          status: shipTable.status,
          queue_entered_at: shipTable.queue_entered_at,
          created_at: shipTable.created_at,
          reviewed_at: shipTable.reviewed_at,
          project_streak_days_at_submission:
            shipTable.project_streak_days_at_submission,
          project_last_worked_date_at_submission:
            shipTable.project_last_worked_date_at_submission,
        })
        .from(shipTable)
        .where(
          and(
            eq(shipTable.user_id, userId),
            inArray(shipTable.project_id, linkedIds),
          ),
        );
  const reviewBridgeShipsByProject = new Map<number, ReviewBridgeShip[]>();
  for (const s of reviewBridgeShipRows) {
    const entry: ReviewBridgeShip = {
      inReviewLoop: (REVIEW_LOOP_SHIP_STATUSES as readonly string[]).includes(
        s.status,
      ),
      queueEnteredAt: s.queue_entered_at,
      createdAt: s.created_at,
      reviewedAt: s.reviewed_at,
      projectStreakDaysAtSubmission: s.project_streak_days_at_submission,
      projectLastWorkedDateAtSubmission:
        s.project_last_worked_date_at_submission,
    };
    const arr = reviewBridgeShipsByProject.get(s.project_id);
    if (arr) arr.push(entry);
    else reviewBridgeShipsByProject.set(s.project_id, [entry]);
  }

  const extended: number[] = [];
  await db.transaction(async (tx) => {
    const lockResult = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(${STREAK_LOCK_NAMESPACE}, ${streakLockKey(userId)}) AS ok
    `);
    // postgres-js returns rows directly; .rows covers node-postgres. A held lock means
    // another sync is in flight and will produce the same result, so skip.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lockRow = (lockResult as any)?.[0] ?? (lockResult as any)?.rows?.[0];
    if (!lockRow?.ok) {
      console.log(
        "[streaks] recompute coalesced (lock held)",
      );
      return;
    }

    // Never inferred as today from a yesterday-only write; see syncLastActiveCandidate.
    let latestAdvancedWorkDay: string | null = null;

    for (const project of linked) {
      if (teamOwnedIds.has(project.id)) continue;
      const names = effectiveNamesByProject.get(project.id) ?? [];

      // Floor at creation (or program start) so a new project linked to an old hackatime
      // project can't inherit pre-existing history.
      const projectFloor = projectStreakFloor(project.created_at, timezone);

      // Recount from the floor every sync so late-arriving hackatime still counts, but never
      // earlier than the day after the last reset (or a reset project would be rebuilt).
      const walkFloor = recomputeWalkFloor({ projectFloor, lastMissedDay });
      let walkDay = walkFloor;
      let recomputed = 0;
      let recomputedLastWorked: string | null = null;
      let strandedAfterLastWorked = 0;
      // Raw per-day signals for the gap-intolerant opted-out resolution below.
      const qualifyingDays = new Set<string>();
      const bridgedDays = new Set<string>();
      const projectJournalSecondsByDay = journalSecondsByProjectDay.get(project.id);
      const storedByDay = storedHackatimeByProject.get(project.id);
      // Per-name linked_at floor so a re-added name doesn't backfill past activity. Names
      // missing from the link table fall back to projectFloor (legacy data drift).
      const perNameLinkedDay = linkedAtByProjectName.get(project.id);
      let driftWarned = false;
      while (walkDay <= today) {
        const gatedNames: string[] = [];
        for (const n of names) {
          const linkedDay = perNameLinkedDay?.get(n);
          if (linkedDay === undefined) {
            if (!driftWarned) {
              console.warn(
                `[streaks] project ${project.id} hackatime name "${n}" missing from project_hackatime_links; falling back to projectFloor`,
              );
              driftWarned = true;
            }
            if (projectFloor <= walkDay) gatedNames.push(n);
          } else if (linkedDay <= walkDay) {
            gatedNames.push(n);
          }
        }
        const hoursQualify = dayQualifiesForProjectStreak({
          liveSeconds: dayProjectSeconds(beatsByDay, perDay, walkDay, gatedNames),
          storedSeconds: storedByDay?.get(walkDay) ?? 0,
          journalSeconds: projectJournalSecondsByDay?.get(walkDay) ?? 0,
        });
        // A frozen day also counts for auto-freeze projects with a running streak, so the
        // freeze protects the plant it was burned for.
        const dayQualifies = projectDayCountsForStreak({
          hoursQualify,
          userStreakStatus: userStatusByDay.get(walkDay) ?? null,
          autoUseStreakFreezes: project.auto_use_streak_freezes,
          projectHasEarlierWork: recomputedLastWorked !== null,
        });
        // Opted-out signals: review days bridge without counting; freezes deliberately don't.
        if (hoursQualify) qualifyingDays.add(walkDay);
        if ((userStatusByDay.get(walkDay) ?? null) === "review_protected") {
          bridgedDays.add(walkDay);
        }
        if (dayQualifies) {
          recomputed += 1;
          recomputedLastWorked = walkDay;
          // Lets resolveRecomputedStreak credit work the increase-only count would freeze out
          // (YYYY-MM-DD strings compare chronologically).
          if (
            project.last_worked_date !== null
            && walkDay > project.last_worked_date
          ) {
            strandedAfterLastWorked += 1;
          }
        }
        walkDay = shiftDay(walkDay, 1);
      }
      // Opted-in projects are gap-tolerant and increase-only: never write below the stored streak.
      let newStreak: number;
      let newLastWorked: string | null;
      if (project.auto_use_streak_freezes) {
        const resolved = resolveRecomputedStreak({
          storedStreak: project.project_streak_days,
          storedLastWorked: project.last_worked_date,
          recomputed,
          recomputedLastWorked,
          strandedAfterLastWorked,
        });
        newStreak = resolved.streak;
        newLastWorked = resolved.lastWorked;
      } else {
        // Opted-out plants wilt the first unwatered day, even while other projects are worked.
        // Bridge all ship review windows first so a decision can't retroactively break the run.
        for (const d of reviewBridgeDaysForProject({
          ships: reviewBridgeShipsByProject.get(project.id) ?? [],
          tz: timezone,
          floor: walkFloor,
          today,
        })) {
          bridgedDays.add(d);
        }
        const gapRun = optedOutProjectStreakFromDays({
          qualifyingDays,
          bridgedDays,
          floor: walkFloor,
          today,
        });
        // Stored streak + days since the stored last_worked, when the run covers back to it,
        // so an opt-out flip doesn't freeze growth for weeks.
        const creditedRun = optedOutCreditedRun({
          qualifyingDays,
          bridgedDays,
          storedStreak: project.project_streak_days,
          storedLastWorked: project.last_worked_date,
          runLastWorked: gapRun.lastWorked,
          today,
        });
        const resolvedRun = Math.max(gapRun.streak, creditedRun);
        if (reviewProtectedProjectIds.has(project.id)) {
          // A ship in review holds the plant: never wilt, but allow upward growth.
          if (
            gapRun.lastWorked !== null
            && resolvedRun > project.project_streak_days
          ) {
            newStreak = resolvedRun;
            newLastWorked = gapRun.lastWorked;
          } else {
            newStreak = project.project_streak_days;
            newLastWorked = project.last_worked_date;
          }
        } else if (gapRun.lastWorked === null) {
          // The only downward write here. walkFloor and the stored high-water seconds keep a
          // transient dip from wilting a live streak, and an idle 0 stays 0.
          newStreak = 0;
          newLastWorked = null;
        } else if (resolvedRun > project.project_streak_days) {
          newStreak = resolvedRun;
          newLastWorked = gapRun.lastWorked;
        } else {
          // Grandfather the stored value: the gap-intolerant rule only applies going forward,
          // so historical gaps never slash a still-live streak.
          newStreak = project.project_streak_days;
          newLastWorked = project.last_worked_date;
        }
      }
      const newStage = streakToStage(newStreak);
      // Only the opted-out idle branch moves down; label the audit so a wilt doesn't read "extended".
      const wilted = newStreak < project.project_streak_days;

      if (
        project.project_streak_days === newStreak
        && project.last_worked_date === newLastWorked
      ) {
        continue;
      }

      try {
        await tx
          .update(projectTable)
          .set({
            project_streak_days: newStreak,
            last_worked_date: newLastWorked,
            stage: newStage,
            updated_at: new Date(),
          })
          .where(eq(projectTable.id, project.id));

        await tx.insert(auditLogTable).values({
          actor_id: userId,
          action: wilted
            ? "project_streak_opted_out_idle_reset"
            : "project_streak_extend",
          entity_type: "project",
          entity_id: String(project.id),
          old_value: {
            project_streak_days: project.project_streak_days,
            last_worked_date: project.last_worked_date,
          },
          new_value: {
            project_streak_days: newStreak,
            last_worked_date: newLastWorked,
            stage: newStage,
            source: "hackatime",
            backfilled: true,
            floor_day: projectFloor,
            walk_floor: walkFloor,
            effective_names: names,
            journal_days_count: projectJournalSecondsByDay?.size ?? 0,
            heartbeat_fallback: usedHeartbeatFallback,
            auto_use_streak_freezes: project.auto_use_streak_freezes,
          },
          sensitive: false,
          public_message: wilted
            ? newStreak === 0
              ? `Project streak reset to 0 from hackatime sync (auto-freeze off, not worked).`
              : `Project streak adjusted to ${newStreak} from hackatime sync (auto-freeze off, gap).`
            : `Project streak extended to ${newStreak} from hackatime sync`,
          change_summary: wilted
            ? "project_streak_opted_out_idle_reset"
            : "hackatime",
        });

        extended.push(project.id);
        latestAdvancedWorkDay = syncLastActiveCandidate(
          latestAdvancedWorkDay,
          newLastWorked,
          today,
          yesterday,
        );
      } catch (err) {
        console.error(
          `[streaks] extendProjectStreaksFromHackatime failed for project ${project.id}:`,
          err,
        );
      }
    }

    if (latestAdvancedWorkDay) {
      const [u] = await tx
        .select({ last_active_date: users.last_active_date })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const candidate = latestAdvancedWorkDay;
      if (!u?.last_active_date || u.last_active_date < candidate) {
        await tx
          .update(users)
          .set({ last_active_date: candidate })
          .where(eq(users.id, userId));
      }
    }
  });

  const allClaimedNames = new Set<string>();
  for (const names of effectiveNamesByProject.values()) {
    for (const n of names) allClaimedNames.add(n);
  }
  // Collaborated names heal the user streak from this user's own heartbeats; recordStreakDay
  // leaves missed days alone, so a broken streak is never resurrected.
  for (const n of collaboratorNames) allClaimedNames.add(n);
  const userFloor = maxDay(
    MACONDO_STREAK_START_DATE,
    shiftDay(today, -(HACKATIME_STREAK_LOOKBACK_DAYS - 1)),
  );

  // Gives the profile calendar history for hackatime-only users. Seconds are merged
  // wall-clock across claimed names; sub-threshold days stay pending for reconcile.
  if (allClaimedNames.size > 0) {
    const claimedNamesArr = Array.from(allClaimedNames);
    // Prefer heartbeat days so a day whose merged stream qualifies (but whose per-project
    // gap-sums are zero) still gets a row.
    for (const day of beatsByDay ? beatsByDay.keys() : perDay.keys()) {
      if (day < userFloor) continue;
      const seconds = dayProjectSeconds(beatsByDay, perDay, day, claimedNamesArr);
      if (seconds <= 0) continue;
      try {
        await db.transaction(async (tx) => {
          await recordStreakDay(tx, userId, day, {
            type: "hackatime",
            secondsToday: seconds,
          });
        });
      } catch {
        console.warn(
          "[streaks] streak_days backfill failed",
        );
      }
    }
  }

  return { extended };
}

// Team projects (>= 1 active collaborator): any member's work extends the shared streak,
// and recomputeTeamProjectStreak is the only writer, so one member's break can't zero it.

// Journal-only team projects are excluded so they keep per-user reset behavior instead
// of being orphaned (excluded from reset but never recomputed).
export async function getTeamProjectIdsOwnedBy(
  userId: string,
): Promise<Set<number>> {
  const rows = await db
    .select({
      project_id: projectCollaboratorTable.project_id,
      hackatime_projects: projectTable.hackatime_projects,
    })
    .from(projectCollaboratorTable)
    .innerJoin(projectTable, eq(projectTable.id, projectCollaboratorTable.project_id))
    .where(
      and(
        eq(projectTable.user_id, userId),
        eq(projectCollaboratorTable.status, "active"),
      ),
    );
  const ids = new Set<number>();
  for (const r of rows) {
    if (Array.isArray(r.hackatime_projects) && r.hackatime_projects.length > 0) {
      ids.add(r.project_id);
    }
  }
  return ids;
}

export async function getActiveTeamProjectIdsForMember(
  userId: string,
): Promise<number[]> {
  const owned = await getTeamProjectIdsOwnedBy(userId);
  const collab = await db
    .select({ project_id: projectCollaboratorTable.project_id })
    .from(projectCollaboratorTable)
    .where(
      and(
        eq(projectCollaboratorTable.user_id, userId),
        eq(projectCollaboratorTable.status, "active"),
      ),
    );
  const set = new Set<number>(owned);
  for (const c of collab) set.add(c.project_id);
  return Array.from(set);
}

/**
 * Idempotent and never strips a higher stored value. Returns null for missing, unlinked or
 * non-team projects, so callers can call it for any project.
 */
export async function recomputeTeamProjectStreak(
  projectId: number,
  now: Date = new Date(),
): Promise<{ updated: boolean; streak: number } | null> {
  const [project] = await db
    .select({
      id: projectTable.id,
      user_id: projectTable.user_id,
      hackatime_projects: projectTable.hackatime_projects,
      created_at: projectTable.created_at,
      project_streak_days: projectTable.project_streak_days,
      last_worked_date: projectTable.last_worked_date,
      stage: projectTable.stage,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  if (!project || !project.user_id) return null;

  const names = (project.hackatime_projects ?? []).filter(Boolean);
  if (names.length === 0) return null;
  const nameSet = new Set(names);

  // No active collaborators means not a team project; the per-user path owns it.
  const collabRows = await db
    .select({ user_id: projectCollaboratorTable.user_id })
    .from(projectCollaboratorTable)
    .where(
      and(
        eq(projectCollaboratorTable.project_id, projectId),
        eq(projectCollaboratorTable.status, "active"),
      ),
    );
  if (collabRows.length === 0) return null;
  const memberIds = Array.from(
    new Set<string>(
      [project.user_id, ...collabRows.map((c) => c.user_id)].filter(
        Boolean,
      ) as string[],
    ),
  );

  // Owner's tz is the project day frame; mixing members' local-day keys accepts a sub-day
  // fuzz at the boundary, like the per-user path.
  const [owner] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, project.user_id))
    .limit(1);
  const ownerTz = owner?.timezone ?? null;
  const today = streakDayKey(now, ownerTz);
  const floor = projectStreakFloor(project.created_at, ownerTz);

  // A member logging the shared repo under their own duplicate project still contributes.
  const memberProjects = await db
    .select({
      id: projectTable.id,
      user_id: projectTable.user_id,
      hackatime_projects: projectTable.hackatime_projects,
    })
    .from(projectTable)
    .where(inArray(projectTable.user_id, memberIds));
  const sharedProjectIds = memberProjects
    .filter((p) => (p.hackatime_projects ?? []).some((n) => nameSet.has(n)))
    .map((p) => p.id);

  const combinedByDay = new Map<string, number>();
  if (sharedProjectIds.length > 0) {
    const dpaRows = await db
      .select({
        day: dailyProjectActivityTable.day,
        secs: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.hackatime_seconds}), 0)::int`,
      })
      .from(dailyProjectActivityTable)
      .where(
        and(
          inArray(dailyProjectActivityTable.project_id, sharedProjectIds),
          inArray(dailyProjectActivityTable.user_id, memberIds),
          gte(dailyProjectActivityTable.day, floor),
        ),
      )
      .groupBy(dailyProjectActivityTable.day);
    for (const r of dpaRows) combinedByDay.set(r.day, Number(r.secs));
  }

  const journalRows = await db
    .select({ created_at: journalsTable.created_at, hours: journalsTable.hours })
    .from(journalsTable)
    .where(
      and(
        eq(journalsTable.project_id, projectId),
        eq(journalsTable.archived, false),
        isNotNull(journalsTable.created_at),
      ),
    );
  for (const j of journalRows) {
    if (!j.created_at) continue;
    const day = streakDayKey(j.created_at, ownerTz);
    if (day < floor) continue;
    const sec = hoursToSeconds(j.hours);
    if (sec <= 0) continue;
    combinedByDay.set(day, (combinedByDay.get(day) ?? 0) + sec);
  }

  // Days any member's own streak was frozen or review-protected bridge the team too.
  const memberStreakDays = await db
    .select({
      user_id: streakDaysTable.user_id,
      day: streakDaysTable.day,
      status: streakDaysTable.status,
      seconds_logged: streakDaysTable.seconds_logged,
    })
    .from(streakDaysTable)
    .where(
      and(
        inArray(streakDaysTable.user_id, memberIds),
        gte(streakDaysTable.day, floor),
      ),
    );
  const bridgedDays = new Set<string>();
  for (const d of memberStreakDays) {
    if (d.status === "frozen" || d.status === "review_protected") {
      bridgedDays.add(d.day);
    }
  }

  // Pure collaborators (owning no project linking the shared repo) have no DPA rows for it,
  // since DPA hackatime is written only for the owning project; fold in their own seconds.
  const coveredMemberIds = new Set(
    memberProjects
      .filter((p) => (p.hackatime_projects ?? []).some((n) => nameSet.has(n)))
      .map((p) => p.user_id),
  );
  const gapMemberIds = memberIds.filter((m) => !coveredMemberIds.has(m));
  if (gapMemberIds.length > 0) {
    const secsByMemberDay = new Map<string, Map<string, number>>();
    for (const d of memberStreakDays) {
      if (!d.user_id) continue;
      let byDay = secsByMemberDay.get(d.user_id);
      if (!byDay) {
        byDay = new Map<string, number>();
        secsByMemberDay.set(d.user_id, byDay);
      }
      byDay.set(d.day, Number(d.seconds_logged ?? 0));
    }
    // Bounded to the lookback to cap hackatime calls; older days are already in the
    // never-stripped stored streak.
    const heartbeatFloorRaw = shiftDay(today, -HACKATIME_STREAK_LOOKBACK_DAYS);
    const heartbeatFloor = heartbeatFloorRaw > floor ? heartbeatFloorRaw : floor;
    for (const m of gapMemberIds) {
      const memberDays = secsByMemberDay.get(m);
      if (!memberDays) continue;
      const linkedNames = new Set<string>();
      for (const p of memberProjects) {
        if (p.user_id !== m) continue;
        for (const n of p.hackatime_projects ?? []) linkedNames.add(n);
      }
      for (const n of await getActiveCollaboratorHackatimeNames(m)) {
        linkedNames.add(n);
      }
      if (linkedNames.size === 0) continue;
      // Pure: every name the member logs belongs to this project, so no hackatime call needed.
      const pure = [...linkedNames].every((n) => nameSet.has(n));
      for (const [day, secs] of memberDays) {
        if (day < floor || day > today || secs <= 0) continue;
        if (pure) {
          combinedByDay.set(day, (combinedByDay.get(day) ?? 0) + secs);
          continue;
        }
        // Mixed: the raw daily total over-credits, so attribute only the shared names.
        // Best-effort: a hackatime hiccup must never zero a team streak.
        if (day < heartbeatFloor) continue;
        try {
          const scoped = await getUserHackatimeSecondsForNamesForDay(
            m,
            names,
            day,
          );
          if (scoped > 0) {
            combinedByDay.set(day, (combinedByDay.get(day) ?? 0) + scoped);
          }
        } catch (err) {
          console.error(
            `[recomputeTeamProjectStreak] scoped seconds failed for member ${m} day ${day} project ${projectId}`,
            err,
          );
        }
      }
    }
  }

  const qualifyingDays = new Set<string>();
  for (const [day, secs] of combinedByDay) {
    if (day < floor || day > today) continue;
    if (secs >= HACKATIME_STREAK_DAY_SECONDS) qualifyingDays.add(day);
  }
  const coveredDays = new Set<string>(qualifyingDays);
  for (const day of bridgedDays) {
    if (day >= floor && day <= today) coveredDays.add(day);
  }

  const { streak, lastWorked } = computeTeamRecompute({
    qualifyingDays,
    coveredDays,
    projectFloor: floor,
    today,
    storedStreak: project.project_streak_days,
    storedLastWorked: project.last_worked_date,
  });
  const newStage = streakToStage(streak);

  if (
    project.project_streak_days === streak &&
    project.last_worked_date === lastWorked &&
    project.stage === newStage
  ) {
    return { updated: false, streak };
  }

  const oldStreak = project.project_streak_days;

  await db.transaction(async (tx) => {
    await tx
      .update(projectTable)
      .set({
        project_streak_days: streak,
        last_worked_date: lastWorked,
        stage: newStage,
        updated_at: new Date(),
      })
      .where(eq(projectTable.id, projectId));
    await tx.insert(auditLogTable).values({
      actor_id: project.user_id!,
      action: "team_project_streak_recompute",
      entity_type: "project",
      entity_id: String(projectId),
      old_value: {
        project_streak_days: oldStreak,
        last_worked_date: project.last_worked_date,
        stage: project.stage,
      },
      new_value: {
        project_streak_days: streak,
        last_worked_date: lastWorked,
        stage: newStage,
        source: "team_recompute",
        member_ids: memberIds,
        qualifying_days: qualifyingDays.size,
      },
      sensitive: false,
      public_message: `Team project streak recomputed to ${streak} from combined member activity.`,
      change_summary: "team_project_streak_recompute",
    });

    if (oldStreak > 0 && streak === 0) {
      await tx.insert(auditLogTable).values({
        actor_id: project.user_id!,
        action: "team_project_streak_lapsed",
        entity_type: "project",
        entity_id: String(projectId),
        old_value: { project_streak_days: oldStreak, last_worked_date: project.last_worked_date, stage: project.stage },
        new_value: { project_streak_days: 0, last_worked_date: null, stage: "never" },
        sensitive: false,
        public_message: `Team project streak lapsed from ${oldStreak} to 0 (no qualifying team activity in the window).`,
        change_summary: "team_project_streak_lapsed",
      });
    }
  });

  return { updated: true, streak };
}

// One summary per reconcile run. notify() swallows its own errors, so this can't break reconcile.
async function notifyFreezeUsed(
  userId: string,
  days: string[],
  freezesLeft: number,
): Promise<void> {
  const count = days.length;
  const body =
    `We used ${count} ${count === 1 ? "streak freeze" : "streak freezes"} to keep your streak alive (${days.join(", ")}). ` +
    `You have ${freezesLeft} streak ${freezesLeft === 1 ? "freeze" : "freezes"} left.`;
  await notify({
    user_id: userId,
    type: "streak_freeze_used",
    title: count === 1 ? "Streak freeze used" : "Streak freezes used",
    body,
    action_url: "/dashboard",
    entity_type: "user",
    entity_id: userId,
    slack: { text: body },
  });
}

// refundedCount can be below the day count when the wallet was at the cap; the day still
// stops being frozen, which is what the user cares about.
async function notifyFreezeRefunded(
  userId: string,
  days: string[],
  refundedCount: number,
  freezesLeft: number,
): Promise<void> {
  const { title, body } = freezeRefundedNotification({
    days,
    refundedCount,
    freezesLeft,
  });
  await notify({
    user_id: userId,
    type: "streak_freeze_used",
    title,
    body,
    action_url: "/dashboard",
    entity_type: "user",
    entity_id: userId,
    slack: { text: body },
  });
}

/**
 * Lazy freeze-burn / break check run on session reads: burns a freeze per unworked gap day
 * and resets every project streak when freezes run out. Already-statused days are left alone.
 */
export async function reconcileFreezesIfStale(
  userId: string,
): Promise<{ streak_freezes_remaining: number; reset: boolean }> {
  const [u] = await db
    .select({
      streak_freezes_remaining: users.streak_freezes_remaining,
      last_active_date: users.last_active_date,
      timezone: users.timezone,
      auto_use_streak_freezes: users.auto_use_streak_freezes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new Error(`reconcileFreezesIfStale: user ${userId} not found`);

  // The streak game is over. Without this, every session read live-rechecked Hackatime for
  // each day since the user's last activity, a list that grows daily for everyone.
  if (macondoHasEnded()) {
    return { streak_freezes_remaining: u.streak_freezes_remaining, reset: false };
  }

  // Local-day today matches the per-tz streak day keys.
  const today = streakDayKey(new Date(), u.timezone);
  if (
    u.last_active_date === null ||
    u.last_active_date === today ||
    u.last_active_date === yesterdayStr(today)
  ) {
    return {
      streak_freezes_remaining: u.streak_freezes_remaining,
      reset: false,
    };
  }

  // Batch sync may lag this cron, so recheck live hackatime per gap day (outside the tx so a
  // slow API call holds no connection); days that qualify flip to active instead of frozen.
  const yesterday = yesterdayStr(today);
  const initialFirstGap = shiftDay(u.last_active_date, 1);
  const recheckByDay = new Map<
    string,
    { liveSeconds: number; storedSeconds: number; journalSeconds: number }
  >();
  if (initialFirstGap <= yesterday) {
    const gapDays: string[] = [];
    let walk = initialFirstGap;
    while (walk <= yesterday) {
      gapDays.push(walk);
      walk = shiftDay(walk, 1);
    }

    const dpaRows = gapDays.length === 0
      ? []
      : await db
          .select({
            day: dailyProjectActivityTable.day,
            journal_seconds: dailyProjectActivityTable.journal_seconds,
            hackatime_seconds: dailyProjectActivityTable.hackatime_seconds,
          })
          .from(dailyProjectActivityTable)
          .where(
            and(
              eq(dailyProjectActivityTable.user_id, userId),
              inArray(dailyProjectActivityTable.day, gapDays),
            ),
          );
    const aggByDay = new Map<
      string,
      { journalSeconds: number; storedSeconds: number }
    >();
    for (const r of dpaRows) {
      const prev = aggByDay.get(r.day) ?? { journalSeconds: 0, storedSeconds: 0 };
      prev.journalSeconds += r.journal_seconds ?? 0;
      prev.storedSeconds += r.hackatime_seconds ?? 0;
      aggByDay.set(r.day, prev);
    }

    const liveResults = await Promise.all(
      gapDays.map(async (d) => {
        try {
          return [d, await getUserLinkedHackatimeSecondsForDay(userId, d)] as const;
        } catch {
          return [d, 0] as const;
        }
      }),
    );
    for (const [d, liveSeconds] of liveResults) {
      const agg = aggByDay.get(d) ?? { journalSeconds: 0, storedSeconds: 0 };
      recheckByDay.set(d, {
        liveSeconds,
        storedSeconds: agg.storedSeconds,
        journalSeconds: agg.journalSeconds,
      });
    }
  }

  // Gap days with a ship in review are held as review_protected without a freeze burn;
  // keyed in the user's tz to match streak_days.day.
  const reviewProtectedDays = initialFirstGap <= yesterday
    ? await getReviewProtectedDaysForUser(
        userId,
        u.timezone ?? "UTC",
        initialFirstGap,
        yesterday,
      )
    : new Set<string>();

  // Team projects belong to the whole team (recomputeTeamProjectStreak), so one member
  // running out of freezes never resets them here.
  const teamProjectIds = await getTeamProjectIdsOwnedBy(userId);

  // Notify after commit: notify() uses the global db handle and must not fire for a
  // rolled-back transaction.
  let burnedFreezeDays: string[] = [];
  let freezesAfterBurn = u.streak_freezes_remaining;

  const reconcileResult = await db.transaction(async (tx) => {
    const [u2] = await tx
      .select({
        streak_freezes_remaining: users.streak_freezes_remaining,
        last_active_date: users.last_active_date,
        auto_use_streak_freezes: users.auto_use_streak_freezes,
      })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    if (!u2) {
      throw new Error(`reconcileFreezesIfStale: user ${userId} vanished`);
    }
    if (u2.last_active_date === null) {
      return {
        streak_freezes_remaining: u2.streak_freezes_remaining,
        reset: false,
      };
    }
    if (u2.last_active_date >= yesterday) {
      return {
        streak_freezes_remaining: u2.streak_freezes_remaining,
        reset: false,
      };
    }

    let freezes = u2.streak_freezes_remaining;
    let cursor = shiftDay(u2.last_active_date, 1);
    let didReset = false;
    let walkLast: string | null = null;
    const frozenDays: string[] = [];
    const missedDays: string[] = [];

    // A burn only helps if an opted-in project has a live streak; otherwise every project
    // resets anyway, so let the streak break instead of wasting a freeze.
    const userProjectsForFreeze = await tx
      .select({
        id: projectTable.id,
        auto_use_streak_freezes: projectTable.auto_use_streak_freezes,
        project_streak_days: projectTable.project_streak_days,
        deleted_at: projectTable.deleted_at,
      })
      .from(projectTable)
      .where(eq(projectTable.user_id, userId));
    const hasProtectableProject = hasProtectableProjectStreak(
      userProjectsForFreeze,
      // Projects already in review are protected from the reset, so a freeze buys them nothing.
      await getProjectsProtectedByActiveReview(userId),
    );

    while (cursor <= yesterday) {
      const [existing] = await tx
        .select({ status: streakDaysTable.status })
        .from(streakDaysTable)
        .where(
          and(
            eq(streakDaysTable.user_id, userId),
            eq(streakDaysTable.day, cursor),
          ),
        )
        .limit(1);

      if (existing?.status === "active") {
        walkLast = cursor;
        cursor = shiftDay(cursor, 1);
        continue;
      }
      if (existing?.status === "frozen") {
        walkLast = cursor;
        cursor = shiftDay(cursor, 1);
        continue;
      }
      if (existing?.status === "review_protected") {
        walkLast = cursor;
        cursor = shiftDay(cursor, 1);
        continue;
      }
      if (existing?.status === "missed") {
        didReset = true;
        break;
      }

      // Covers batch sync lagging reconcile: a gap day that actually qualified becomes
      // active instead of burning a freeze.
      const recheck = recheckByDay.get(cursor);
      if (
        recheck &&
        dayQualifiesForProjectStreak({
          liveSeconds: recheck.liveSeconds,
          storedSeconds: recheck.storedSeconds,
          journalSeconds: recheck.journalSeconds,
          threshold: USER_STREAK_THRESHOLD_SECONDS,
        })
      ) {
        const recoveredSeconds = Math.max(
          recheck.liveSeconds,
          recheck.storedSeconds,
        );
        await tx
          .insert(streakDaysTable)
          .values({
            user_id: userId,
            day: cursor,
            status: "active",
            seconds_logged: recoveredSeconds,
            had_journal: false,
          })
          .onConflictDoUpdate({
            target: [streakDaysTable.user_id, streakDaysTable.day],
            set: {
              status: "active",
              seconds_logged: recoveredSeconds,
              updated_at: new Date(),
            },
          });
        await tx.insert(auditLogTable).values({
          actor_id: userId,
          action: "streak_day_recovered_during_reconcile",
          entity_type: "user",
          entity_id: userId,
          old_value: { day: cursor, would_have: "frozen" },
          new_value: {
            day: cursor,
            status: "active",
            seconds_logged: recoveredSeconds,
            live_seconds: recheck.liveSeconds,
            stored_seconds: recheck.storedSeconds,
            journal_seconds: recheck.journalSeconds,
          },
          sensitive: false,
          public_message: `Reconcile recovered streak for ${cursor} (live recheck found ${recoveredSeconds}s).`,
          change_summary: "streak_day_recovered_during_reconcile",
        });
        walkLast = cursor;
        cursor = shiftDay(cursor, 1);
        continue;
      }

      // A ship in review holds the day without burning a freeze; the reset-time protection
      // below only covers running out of freezes.
      if (reviewProtectedDays.has(cursor)) {
        await tx
          .insert(streakDaysTable)
          .values({
            user_id: userId,
            day: cursor,
            status: "review_protected",
            seconds_logged: 0,
            had_journal: false,
          })
          .onConflictDoUpdate({
            target: [streakDaysTable.user_id, streakDaysTable.day],
            set: { status: "review_protected", updated_at: new Date() },
          });
        await tx.insert(auditLogTable).values({
          actor_id: userId,
          action: "streak_freeze_skipped_review_protected",
          entity_type: "user",
          entity_id: userId,
          old_value: { day: cursor, would_have: "frozen_via_freeze_burn" },
          new_value: {
            day: cursor,
            status: "review_protected",
            reason: "active_ship_in_review",
          },
          sensitive: false,
          public_message: `Day ${cursor} held without consuming a freeze (ship in review).`,
          change_summary: "streak_freeze_skipped_review_protected",
        });
        walkLast = cursor;
        cursor = shiftDay(cursor, 1);
        continue;
      }

      // Driven by per-project opt-in; the profile master checkbox only bulk-sets those flags.
      if (freezes > 0 && hasProtectableProject) {
        freezes -= 1;
        frozenDays.push(cursor);
        await tx
          .insert(streakDaysTable)
          .values({
            user_id: userId,
            day: cursor,
            status: "frozen",
            seconds_logged: 0,
            had_journal: false,
          })
          .onConflictDoUpdate({
            target: [streakDaysTable.user_id, streakDaysTable.day],
            set: { status: "frozen", updated_at: new Date() },
          });
        walkLast = cursor;
        cursor = shiftDay(cursor, 1);
        continue;
      }

      // missed is irreversible and yesterday's hackatime may still be settling just after
      // local midnight, so leave yesterday for a post-grace reconcile.
      if (cursor === yesterday && inPostMidnightGrace(new Date(), u.timezone)) {
        break;
      }

      missedDays.push(cursor);
      await tx
        .insert(streakDaysTable)
        .values({
          user_id: userId,
          day: cursor,
          status: "missed",
          seconds_logged: 0,
          had_journal: false,
        })
        .onConflictDoUpdate({
          target: [streakDaysTable.user_id, streakDaysTable.day],
          set: { status: "missed", updated_at: new Date() },
        });
      didReset = true;
      break;
    }

    if (didReset) {
      // A pre-existing missed row means a prior reconcile already reset; skip the duplicate
      // reset and audit when nothing new happened this run.
      if (missedDays.length === 0 && frozenDays.length === 0) {
        return { streak_freezes_remaining: freezes, reset: true };
      }

      // Projects in review are skipped so a slow review doesn't cost the student their streak.
      const allProjects = await tx
        .select({
          id: projectTable.id,
          project_streak_days: projectTable.project_streak_days,
          last_worked_date: projectTable.last_worked_date,
          stage: projectTable.stage,
        })
        .from(projectTable)
        .where(eq(projectTable.user_id, userId));

      const protectedIds = await getProjectsProtectedByActiveReview(userId);
      const protectedProjects = allProjects.filter((p) => protectedIds.has(p.id));
      const projSnapshot = allProjects.map((p) => ({
        id: p.id,
        project_streak_days: p.project_streak_days,
        stage: p.stage,
      }));
      const resettableIds = allProjects
        .map((p) => p.id)
        .filter((id) => !protectedIds.has(id) && !teamProjectIds.has(id));

      if (resettableIds.length > 0) {
        await tx
          .update(projectTable)
          .set({
            project_streak_days: 0,
            last_worked_date: null,
            stage: 1,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(projectTable.user_id, userId),
              inArray(projectTable.id, resettableIds),
            ),
          );
      }

      // Audit each project held by review so /internal can see why its plant survived.
      const firstMissed = missedDays[0] ?? null;
      for (const proj of protectedProjects) {
        await tx.insert(auditLogTable).values({
          actor_id: userId,
          action: "project_streak_protected_under_review",
          entity_type: "project",
          entity_id: String(proj.id),
          old_value: {
            project_streak_days: proj.project_streak_days,
            last_worked_date: proj.last_worked_date,
            stage: proj.stage,
          },
          new_value: {
            project_streak_days: proj.project_streak_days,
            last_worked_date: proj.last_worked_date,
            stage: proj.stage,
            reason: "active_ship_in_review",
            missed_day: firstMissed,
          },
          sensitive: false,
          public_message: firstMissed
            ? `Project streak held at ${proj.project_streak_days} on ${firstMissed} (ship in review).`
            : `Project streak held at ${proj.project_streak_days} (ship in review).`,
          change_summary: "project_streak_protected_under_review",
        });
      }

      // With a protected project, anchor last_active_date at the last kept day so the next
      // reconcile doesn't re-burn from scratch.
      const newLastActiveAfterProtected = protectedProjects.length > 0
        ? walkLast ?? u2.last_active_date
        : null;

      await tx
        .update(users)
        .set({
          streak_freezes_remaining: freezes,
          last_active_date: newLastActiveAfterProtected,
        })
        .where(eq(users.id, userId));

      // Distinguishes "nothing opted in wanted the freezes" from genuinely running out.
      const optedOutWithFreezes =
        freezes > 0 && !hasProtectableProject;
      await tx.insert(auditLogTable).values({
        actor_id: userId,
        action: "all_streaks_reset",
        entity_type: "user",
        entity_id: userId,
        old_value: {
          last_active_date: u2.last_active_date,
          freezes: u2.streak_freezes_remaining,
          auto_use_streak_freezes: u2.auto_use_streak_freezes,
          projects: projSnapshot,
        },
        new_value: {
          last_active_date: newLastActiveAfterProtected,
          freezes,
          missed_days: missedDays,
          frozen_days: frozenDays,
          protected_project_ids: protectedProjects.map((p) => p.id),
        },
        sensitive: false,
        public_message: optedOutWithFreezes
          ? missedDays[0]
            ? `All project streaks reset on ${missedDays[0]} (auto-freeze opt-out).`
            : "All project streaks reset (auto-freeze opt-out)."
          : missedDays[0]
            ? `All project streaks reset on ${missedDays[0]} (out of streak freezes).`
            : "All project streaks reset (out of streak freezes).",
        change_summary: optedOutWithFreezes
          ? "all_streaks_reset_opted_out"
          : "all_streaks_reset",
      });

      return { streak_freezes_remaining: freezes, reset: true };
    }

    if (frozenDays.length > 0 || walkLast) {
      await tx
        .update(users)
        .set({
          streak_freezes_remaining: freezes,
          last_active_date: walkLast ?? u2.last_active_date,
        })
        .where(eq(users.id, userId));
    }

    // Opted-out projects don't ride along on a burned freeze and reset on the first frozen
    // day; projects in review stay protected regardless.
    const optedOutResetProjectIds: number[] = [];
    const optedOutProtectedProjects: Array<{
      id: number;
      project_streak_days: number;
      stage: number | null;
      last_worked_date: string | null;
    }> = [];
    if (frozenDays.length > 0) {
      const protectedIdsForOptOut = await getProjectsProtectedByActiveReview(userId);
      // Team projects are never reset by the per-user reconcile.
      const optedOutProjects = (
        await tx
          .select({
            id: projectTable.id,
            project_streak_days: projectTable.project_streak_days,
            stage: projectTable.stage,
            last_worked_date: projectTable.last_worked_date,
          })
          .from(projectTable)
          .where(
            and(
              eq(projectTable.user_id, userId),
              eq(projectTable.auto_use_streak_freezes, false),
              gte(projectTable.project_streak_days, 1),
            ),
          )
      ).filter((p) => !teamProjectIds.has(p.id));

      for (const p of optedOutProjects) {
        if (protectedIdsForOptOut.has(p.id)) {
          optedOutProtectedProjects.push(p);
        } else {
          optedOutResetProjectIds.push(p.id);
        }
      }

      if (optedOutResetProjectIds.length > 0) {
        await tx
          .update(projectTable)
          .set({
            project_streak_days: 0,
            last_worked_date: null,
            stage: 1,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(projectTable.user_id, userId),
              inArray(projectTable.id, optedOutResetProjectIds),
            ),
          );

        const firstFrozenDay = frozenDays[0];
        for (const proj of optedOutProjects) {
          if (protectedIdsForOptOut.has(proj.id)) continue;
          await tx.insert(auditLogTable).values({
            actor_id: userId,
            action: "project_streak_reset_opted_out",
            entity_type: "project",
            entity_id: String(proj.id),
            old_value: {
              project_streak_days: proj.project_streak_days,
              last_worked_date: proj.last_worked_date,
              stage: proj.stage,
            },
            new_value: {
              project_streak_days: 0,
              last_worked_date: null,
              stage: 1,
              frozen_day: firstFrozenDay,
            },
            sensitive: false,
            public_message: `Project streak reset on ${firstFrozenDay} (auto-freeze opted out).`,
            change_summary: "project_streak_reset_opted_out",
          });
        }
      }

      // Audit opted-out projects that survived because of a ship in review.
      const firstFrozenDay = frozenDays[0];
      for (const proj of optedOutProtectedProjects) {
        await tx.insert(auditLogTable).values({
          actor_id: userId,
          action: "project_streak_protected_under_review",
          entity_type: "project",
          entity_id: String(proj.id),
          old_value: {
            project_streak_days: proj.project_streak_days,
            last_worked_date: proj.last_worked_date,
            stage: proj.stage,
          },
          new_value: {
            project_streak_days: proj.project_streak_days,
            last_worked_date: proj.last_worked_date,
            stage: proj.stage,
            reason: "active_ship_in_review",
            frozen_day: firstFrozenDay,
          },
          sensitive: false,
          public_message: `Project streak held at ${proj.project_streak_days} on ${firstFrozenDay} (ship in review).`,
          change_summary: "project_streak_protected_under_review",
        });
      }
    }

    if (frozenDays.length > 0) {
      await tx.insert(auditLogTable).values({
        actor_id: userId,
        action: "streak_freeze_consumed",
        entity_type: "user",
        entity_id: userId,
        old_value: {
          freezes: u2.streak_freezes_remaining,
          last_active_date: u2.last_active_date,
        },
        new_value: {
          freezes,
          last_active_date: walkLast,
          frozen_days: frozenDays,
          projects_opted_out_reset: optedOutResetProjectIds,
        },
        sensitive: false,
        public_message: `Used ${frozenDays.length} streak freeze${frozenDays.length === 1 ? "" : "s"}.`,
        change_summary: "streak_freeze_auto_consume",
      });
      burnedFreezeDays = [...frozenDays];
      freezesAfterBurn = freezes;
    }

    return { streak_freezes_remaining: freezes, reset: false };
  });

  // The reset path leaves burnedFreezeDays empty, since the streak actually broke.
  if (burnedFreezeDays.length > 0) {
    await notifyFreezeUsed(userId, burnedFreezeDays, freezesAfterBurn);
  }

  return reconcileResult;
}

/**
 * Wilts idle opted-out journal-only projects (not worked since before yesterday); the
 * hackatime recompute only covers linked projects. Review-protected and team projects are
 * skipped. Runs from the daily cron, not the hot session read path.
 */
export async function reconcileOptedOutIdleProjects(
  userId: string,
): Promise<{ reset_project_ids: number[] }> {
  const [u] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return { reset_project_ids: [] };

  const yesterday = yesterdayStr(streakDayKey(new Date(), u.timezone));

  // lt excludes NULL last_worked_date, so a corrupt streak/last_worked pairing is never zeroed.
  // Linked projects are owned by the hackatime recompute, keeping one writer per project.
  const journalOnly = (
    await db
      .select({
        id: projectTable.id,
        project_streak_days: projectTable.project_streak_days,
        last_worked_date: projectTable.last_worked_date,
        stage: projectTable.stage,
        hackatime_projects: projectTable.hackatime_projects,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.user_id, userId),
          eq(projectTable.auto_use_streak_freezes, false),
          gte(projectTable.project_streak_days, 1),
          lt(projectTable.last_worked_date, yesterday),
        ),
      )
  ).filter(
    (p) =>
      !Array.isArray(p.hackatime_projects) || p.hackatime_projects.length === 0,
  );
  if (journalOnly.length === 0) return { reset_project_ids: [] };

  const [teamIds, protectedIds] = await Promise.all([
    getTeamProjectIdsOwnedBy(userId),
    getProjectsProtectedByActiveReview(userId),
  ]);
  let toReset = journalOnly.filter(
    (p) => !teamIds.has(p.id) && !protectedIds.has(p.id),
  );
  if (toReset.length === 0) return { reset_project_ids: [] };

  // A ship decision lifts the live hold above; hold the plant through the following day so
  // the queue wait isn't judged as idleness before the maker even sees the decision.
  const decidedShips = await db
    .select({
      project_id: shipTable.project_id,
      reviewed_at: shipTable.reviewed_at,
    })
    .from(shipTable)
    .where(
      and(
        inArray(
          shipTable.project_id,
          toReset.map((p) => p.id),
        ),
        isNotNull(shipTable.reviewed_at),
      ),
    );
  const recentlyClosed = new Set<number>();
  for (const s of decidedShips) {
    if (
      s.reviewed_at
      && streakDayKey(s.reviewed_at, u.timezone) >= yesterday
    ) {
      recentlyClosed.add(s.project_id);
    }
  }
  toReset = toReset.filter((p) => !recentlyClosed.has(p.id));
  if (toReset.length === 0) return { reset_project_ids: [] };

  await db.transaction(async (tx) => {
    for (const p of toReset) {
      await tx
        .update(projectTable)
        .set({
          project_streak_days: 0,
          last_worked_date: null,
          stage: 1,
          updated_at: new Date(),
        })
        .where(eq(projectTable.id, p.id));
      await tx.insert(auditLogTable).values({
        actor_id: userId,
        action: "project_streak_opted_out_idle_reset",
        entity_type: "project",
        entity_id: String(p.id),
        old_value: {
          project_streak_days: p.project_streak_days,
          last_worked_date: p.last_worked_date,
          stage: p.stage,
        },
        new_value: {
          project_streak_days: 0,
          last_worked_date: null,
          stage: 1,
          reason: "journal_only_idle",
          last_worked_before: p.last_worked_date,
        },
        sensitive: false,
        public_message: `Project streak reset to 0 (auto-freeze off, not worked).`,
        change_summary: "project_streak_opted_out_idle_reset",
      });
    }
  });

  return { reset_project_ids: toReset.map((p) => p.id) };
}

/**
 * Writes a recovered day's seconds into DPA, which the plant walk reads as its high-water
 * floor, so a refunded day also counts for the plant. Only with exactly one linked project,
 * since a user-level total can't be split; the write is monotonic.
 */
export async function persistRecoveredDayHackatime(
  userId: string,
  day: string,
  recoveredSeconds: number,
): Promise<void> {
  if (!(recoveredSeconds > 0)) return;
  const linked = (
    await db
      .select({
        id: projectTable.id,
        hackatime_projects: projectTable.hackatime_projects,
      })
      .from(projectTable)
      .where(eq(projectTable.user_id, userId))
  ).filter(
    (p) => Array.isArray(p.hackatime_projects) && p.hackatime_projects.length > 0,
  );
  if (linked.length !== 1) return;
  const projectId = linked[0]!.id;
  const seconds = Math.round(recoveredSeconds);
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: dailyProjectActivityTable.id,
        hackatime_seconds: dailyProjectActivityTable.hackatime_seconds,
      })
      .from(dailyProjectActivityTable)
      .where(
        and(
          eq(dailyProjectActivityTable.user_id, userId),
          eq(dailyProjectActivityTable.project_id, projectId),
          eq(dailyProjectActivityTable.day, day),
        ),
      )
      .for("update")
      .limit(1);
    if (existing) {
      const next = Math.max(existing.hackatime_seconds, seconds);
      if (next === existing.hackatime_seconds) return;
      await tx
        .update(dailyProjectActivityTable)
        .set({ hackatime_seconds: next, updated_at: new Date() })
        .where(eq(dailyProjectActivityTable.id, existing.id));
    } else {
      await tx.insert(dailyProjectActivityTable).values({
        user_id: userId,
        project_id: projectId,
        day,
        journal_seconds: 0,
        hackatime_seconds: seconds,
      });
    }
  });
}

export interface RefundLateActivityResult {
  // freeze actually returned to inventory
  refunded: string[];
  // Days flipped frozen -> active (superset of refunded).
  flipped: string[];
  // Dry-run only: days that would flip if applied.
  wouldRefund: string[];
  checked: number;
}

/**
 * Refunds freezes reconcile burned for frozen days that later qualified from late
 * heartbeats or journals, since reconcile never revisits frozen days. Live fetches are
 * cache-busted and run outside the transaction.
 */
export async function refundFrozenDaysWithLateActivity(
  userId: string,
  opts?: { actorId?: string; windowDays?: number; dryRun?: boolean },
): Promise<RefundLateActivityResult> {
  const dryRun = opts?.dryRun ?? false;
  const actorId = opts?.actorId ?? userId;
  const empty: RefundLateActivityResult = {
    refunded: [],
    flipped: [],
    wouldRefund: [],
    checked: 0,
  };

  const [u] = await db
    .select({
      hackatime_oauth_token: users.hackatime_oauth_token,
      timezone: users.timezone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return empty;

  // Local-day today matches the per-tz streak_days.day keys.
  const floor = shiftDay(
    streakDayKey(new Date(), u.timezone),
    -(opts?.windowDays ?? 14), // default refund window days
  );

  const frozenRows = await db
    .select({ day: streakDaysTable.day })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        eq(streakDaysTable.status, "frozen"),
        gte(streakDaysTable.day, floor),
      ),
    );
  if (frozenRows.length === 0) return empty;
  const frozenDays = frozenRows.map((r) => r.day).sort();

  const dpaRows = await db
    .select({
      day: dailyProjectActivityTable.day,
      journal_seconds: dailyProjectActivityTable.journal_seconds,
      hackatime_seconds: dailyProjectActivityTable.hackatime_seconds,
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, userId),
        inArray(dailyProjectActivityTable.day, frozenDays),
      ),
    );
  const aggByDay = new Map<
    string,
    { journalSeconds: number; storedSeconds: number }
  >();
  for (const r of dpaRows) {
    const prev = aggByDay.get(r.day) ?? { journalSeconds: 0, storedSeconds: 0 };
    prev.journalSeconds += r.journal_seconds ?? 0;
    prev.storedSeconds += r.hackatime_seconds ?? 0;
    aggByDay.set(r.day, prev);
  }

  // Live, cache-busted hackatime per frozen day (outside any transaction).
  const liveByDay = new Map<string, number>();
  for (const day of frozenDays) {
    try {
      liveByDay.set(
        day,
        await getUserLinkedHackatimeSecondsForDay(userId, day, { forceFresh: true }),
      );
    } catch {
      liveByDay.set(day, 0);
    }
  }

  const result: RefundLateActivityResult = {
    refunded: [],
    flipped: [],
    wouldRefund: [],
    checked: 0,
  };
  // Wallet balance after the last applied refund, for the notification below.
  let freezesLeft = 0;

  for (const day of frozenDays) {
    result.checked += 1;
    const agg = aggByDay.get(day) ?? { journalSeconds: 0, storedSeconds: 0 };
    const live = liveByDay.get(day) ?? 0;

    // Cheap pre-filter so days that still don't qualify never open a transaction.
    if (
      !dayQualifiesForProjectStreak({
        liveSeconds: live,
        storedSeconds: agg.storedSeconds,
        journalSeconds: agg.journalSeconds,
        threshold: USER_STREAK_THRESHOLD_SECONDS,
      })
    ) {
      continue;
    }
    if (dryRun) {
      result.wouldRefund.push(day);
      continue;
    }

    const applied = await db.transaction(async (tx) => {
      const [su] = await tx
        .select({ streak_freezes_remaining: users.streak_freezes_remaining })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      if (!su) return null;

      const [existing] = await tx
        .select({
          status: streakDaysTable.status,
          seconds_logged: streakDaysTable.seconds_logged,
        })
        .from(streakDaysTable)
        .where(
          and(
            eq(streakDaysTable.user_id, userId),
            eq(streakDaysTable.day, day),
          ),
        )
        .for("update")
        .limit(1);
      // Raced with another reconcile / refund that already resolved it.
      if (existing?.status !== "frozen") return null;

      const plan = planFreezeRefund({
        currentStatus: "frozen",
        liveSeconds: live,
        storedSeconds: agg.storedSeconds,
        journalSeconds: agg.journalSeconds,
        freezesRemaining: su.streak_freezes_remaining,
        threshold: USER_STREAK_THRESHOLD_SECONDS,
        maxFreezes: MAX_STREAK_FREEZES,
      });
      if (!plan.flip) {
        await tx.insert(auditLogTable).values({
          actor_id: actorId,
          action: "streak_freeze_refund_skipped",
          entity_type: "user",
          entity_id: userId,
          old_value: { day, prior_status: "frozen", seconds_logged: existing.seconds_logged ?? 0 },
          new_value: {
            day,
            qualifies: plan.qualifies,
            freezes: su.streak_freezes_remaining,
            reason: "plan.flip was false (match of qualifies checks diverged from the pre-filter, or currentStatus was not frozen inside the tx)",
            source: "reconcile_sweep",
          },
          sensitive: false,
          public_message: `Skipped freeze refund for ${day}: the combined-sum check qualified but the detailed plan decided not to flip.`,
          change_summary: "streak_freeze_refund_skipped",
        });
        return null;
      }

      await tx
        .update(streakDaysTable)
        .set({
          status: "active",
          seconds_logged: Math.max(
            existing.seconds_logged ?? 0,
            plan.recoveredSeconds,
          ),
          updated_at: new Date(),
        })
        .where(
          and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, day)),
        );

      if (plan.refunded) {
        await tx
          .update(users)
          .set({ streak_freezes_remaining: plan.newFreezes })
          .where(eq(users.id, userId));
      }

      await tx.insert(auditLogTable).values({
        actor_id: actorId,
        action: "streak_freeze_refunded_late_activity",
        entity_type: "user",
        entity_id: userId,
        old_value: {
          day,
          freezes: su.streak_freezes_remaining,
          prior_status: "frozen",
          prior_seconds: existing.seconds_logged ?? 0,
        },
        new_value: {
          day,
          freezes: plan.newFreezes,
          status: "active",
          seconds_logged: plan.recoveredSeconds,
          live_seconds: live,
          stored_seconds: agg.storedSeconds,
          journal_seconds: agg.journalSeconds,
          refunded: plan.refunded,
          source: "reconcile_sweep",
        },
        sensitive: false,
        public_message: plan.refunded
          ? `Refunded 1 streak freeze: ${day} qualified after late activity arrived.`
          : `Promoted ${day} to active after late activity; freeze not refunded (already at cap).`,
        change_summary: "streak_freeze_refunded_late_activity",
      });
      return plan;
    });

    if (applied) {
      result.flipped.push(day);
      freezesLeft = applied.newFreezes;
      if (applied.refunded) result.refunded.push(day);
      // So the day counts toward the plant too, not just streak_days; best-effort and monotonic.
      try {
        await persistRecoveredDayHackatime(userId, day, applied.recoveredSeconds);
      } catch (err) {
        console.error(
          `[refund-late-activity] persistRecoveredDayHackatime failed for ${userId} ${day}`,
          err,
        );
      }
    }
  }

  // The burn sent a "freeze used" notification, so make the refund just as visible.
  if (result.flipped.length > 0) {
    await notifyFreezeRefunded(
      userId,
      result.flipped,
      result.refunded.length,
      freezesLeft,
    );
  }

  // Restore project streaks an opt-out reset cleared. Pass the tz: a null one forces the
  // UTC-bucketed fallback and misdates recovered days.
  if (result.flipped.length > 0 && u.hackatime_oauth_token) {
    try {
      await extendProjectStreaksFromHackatime(
        userId,
        u.hackatime_oauth_token,
        u.timezone,
      );
    } catch (err) {
      console.error(
        `[refund-late-activity] extendProjectStreaksFromHackatime failed for ${userId}`,
        err,
      );
    }
  }

  return result;
}

export async function getStreakCalendar(
  userId: string,
  startDay: string,
  endDay: string,
): Promise<
  Array<{
    day: string;
    status: "pending" | "active" | "frozen" | "missed" | "review_protected";
    seconds_logged: number;
    had_journal: boolean;
  }>
> {
  return db
    .select({
      day: streakDaysTable.day,
      status: streakDaysTable.status,
      seconds_logged: streakDaysTable.seconds_logged,
      had_journal: streakDaysTable.had_journal,
    })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        between(streakDaysTable.day, startDay, endDay),
      ),
    )
    .orderBy(streakDaysTable.day);
}

/**
 * The dashboard's current streak from streak_days: active and frozen days count,
 * review_protected days bridge without counting, and a pending today doesn't break the run.
 * A run longer than the scan window is reported as the window length.
 */
export async function getUserCurrentStreak(
  userId: string,
  timezone?: string | null,
  // Today qualified live but its row may not be active yet; lets the headline count it now.
  todayQualifiedLive?: boolean,
): Promise<number> {
  const today = streakDayKey(new Date(), timezone);
  // Far beyond any real streak while staying a single range scan.
  const windowStart = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 400);
    return d.toISOString().slice(0, 10);
  })();

  const rows = await db
    .select({
      day: streakDaysTable.day,
      status: streakDaysTable.status,
    })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.user_id, userId),
        between(streakDaysTable.day, windowStart, today),
      ),
    );

  return currentStreakLengthFromDays({
    statusByDay: new Map(rows.map((r) => [r.day, r.status])),
    today,
    windowStart,
    todayQualifiedLive,
  });
}

/**
 * The headline streak for both /api/auth/me and /api/profile/streaks, so they can't drift.
 * Fault-isolated: sub-query failures degrade to the day-run since both are hot paths.
 */
export async function computeDashboardStreak(
  userId: string,
  timezone?: string | null,
  // Pass the same signal that lights the "worked today" progress bar so the two agree.
  todayQualifiedLive?: boolean,
): Promise<number> {
  let run = 0;
  try {
    run = await getUserCurrentStreak(userId, timezone, todayQualifiedLive);
  } catch (err) {
    console.error("[computeDashboardStreak] current streak lookup failed", err);
  }
  try {
    const [maxProj] = await db
      .select({
        max: sql<number | null>`max(${projectTable.project_streak_days})`,
      })
      .from(projectTable)
      .where(eq(projectTable.user_id, userId));
    // While a ship is in an open review window, don't drop below the streak captured at submission.
    const [reviewFloorRow] = await db
      .select({
        max: sql<number | null>`max(${shipTable.user_streak_at_submission})`,
      })
      .from(shipTable)
      .where(
        and(
          eq(shipTable.user_id, userId),
          inArray(shipTable.status, REVIEW_LOOP_SHIP_STATUSES),
          isNull(shipTable.reviewed_at),
        ),
      );
    // Only while the maker had nothing else to work on: a workable solo project not in
    // review means they could have kept the streak.
    let reviewFloor = reviewFloorRow?.max ?? null;
    if (reviewFloor !== null) {
      const [protectedIds, teamIds, ownedProjects] = await Promise.all([
        getProjectsProtectedByActiveReview(userId),
        getTeamProjectIdsOwnedBy(userId),
        db
          .select({ id: projectTable.id })
          .from(projectTable)
          .where(eq(projectTable.user_id, userId)),
      ]);
      if (ownedProjects.some((p) => !teamIds.has(p.id) && !protectedIds.has(p.id))) {
        reviewFloor = null;
      }
    }
    return dashboardStreak({
      streakDaysRun: run,
      maxProjectStreak: maxProj?.max ?? null,
      reviewFloor,
    });
  } catch (err) {
    console.error("[computeDashboardStreak] project/review floor failed", err);
    return run;
  }
}
