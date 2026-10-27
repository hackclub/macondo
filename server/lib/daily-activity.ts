// hackatime_seconds is re-derived each sync rather than incremented, since offline syncs can backfill heartbeats.
// Duplicate-linked projects get 0 hackatime seconds (earliest-claim rule), matching the streak anti-gaming rule.

import { useRuntimeConfig } from "#imports";

import { and, asc, eq, ne, or, sql } from "drizzle-orm";

import db from "../db";
import {
  dailyProjectActivityTable,
  journalsTable,
  projectCollaboratorTable,
  projectTable,
  users,
} from "../db/schema";
import {
  MACONDO_HOURS_START_DATE,
  type PerProjectDailyResult,
  dayProjectSeconds,
  fetchPerProjectDailyDurations,
  fetchPerProjectDailyDurationsByLocalDay,
  requalifyPendingStreakDaysForUser,
  streakDayKey,
} from "./streaks";
import {
  MAX_DAILY_SECONDS_PER_PROJECT as MAX_DAILY_SECONDS_PER_PROJECT_HELPER,
  effectiveHackatimeNamesByProject,
  hoursToSeconds as hoursToSecondsHelper,
  nextMonotonicHackatimeSeconds as nextMonotonicHackatimeSecondsHelper,
} from "./streak-helpers";

// Applied at query time, so changing it doesn't require a backfill.
export const DAILY_ACTIVITY_THRESHOLD_SECONDS = 5 * 60;

// Defined in streak-helpers to break a circular import with streaks.ts; re-exported for existing imports.
export const MAX_DAILY_SECONDS_PER_PROJECT = MAX_DAILY_SECONDS_PER_PROJECT_HELPER;
export const hoursToSeconds = hoursToSecondsHelper;
export const nextMonotonicHackatimeSeconds = nextMonotonicHackatimeSecondsHelper;

// Bucketed by the user's local day, unlike the hackatime cumulative probe (UTC midnight), so it doesn't
// leak the previous evening for users west of UTC.
export async function getUserCombinedSecondsForDay(
  userId: string,
  day: string,
): Promise<number> {
  const [row] = await db
    .select({
      combined_seconds: sql<number>`COALESCE(SUM(${dailyProjectActivityTable.journal_seconds} + ${dailyProjectActivityTable.hackatime_seconds}), 0)::int`,
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, userId),
        eq(dailyProjectActivityTable.day, day),
      ),
    );
  return Number(row?.combined_seconds ?? 0);
}

// Monotonic: hackatime "cumulative since" totals can drift downward after the day ends. Explicit zeroing
// goes through a direct UPDATE in recomputeUserHackatimeActivity instead.
export async function setHackatimeSeconds(
  userId: string,
  projectId: number,
  day: string,
  totalSeconds: number,
): Promise<void> {
  const seconds = Math.max(0, Math.round(totalSeconds));
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
      const next = nextMonotonicHackatimeSeconds(
        existing.hackatime_seconds,
        seconds,
      );
      if (next === existing.hackatime_seconds) return;
      await tx
        .update(dailyProjectActivityTable)
        .set({ hackatime_seconds: next, updated_at: new Date() })
        .where(eq(dailyProjectActivityTable.id, existing.id));
    } else if (seconds > 0) {
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

// Days the API didn't return are left alone. Takes the already-fetched perDay map to avoid extra API calls.
export async function recomputeUserHackatimeActivity(
  userId: string,
  timezone: string | null,
  perDay: Map<string, Map<string, number>>,
  beatsByDay: PerProjectDailyResult["beatsByDay"],
  projects: Array<{
    id: number;
    hackatime_projects: string[] | null;
    created_at: Date | null;
    deleted_at?: Date | null;
  }>,
): Promise<{ updatedRows: number }> {
  const namesByProject = effectiveHackatimeNamesByProject(projects);
  let updatedRows = 0;

  for (const project of projects) {
    const names = namesByProject.get(project.id) ?? [];
    if (names.length === 0) {
      // Zero stale values, e.g. after hackatime was re-linked to a different project.
      updatedRows += (
        await db
          .update(dailyProjectActivityTable)
          .set({ hackatime_seconds: 0, updated_at: new Date() })
          .where(
            and(
              eq(dailyProjectActivityTable.user_id, userId),
              eq(dailyProjectActivityTable.project_id, project.id),
              ne(dailyProjectActivityTable.hackatime_seconds, 0),
            ),
          )
          .returning({ id: dailyProjectActivityTable.id })
      ).length;
      continue;
    }

    // Union of both sources so a day with a non-zero merged stream is written and stale rows get cleared.
    const dayKeys = new Set<string>(perDay.keys());
    if (beatsByDay) for (const d of beatsByDay.keys()) dayKeys.add(d);
    for (const day of dayKeys) {
      // Merge names by wall-clock so multiple linked names don't double-count.
      const total = dayProjectSeconds(beatsByDay, perDay, day, names);
      if (total === 0) {
        const [existing] = await db
          .select({
            id: dailyProjectActivityTable.id,
            hackatime_seconds: dailyProjectActivityTable.hackatime_seconds,
          })
          .from(dailyProjectActivityTable)
          .where(
            and(
              eq(dailyProjectActivityTable.user_id, userId),
              eq(dailyProjectActivityTable.project_id, project.id),
              eq(dailyProjectActivityTable.day, day),
            ),
          )
          .limit(1);
        if (existing && existing.hackatime_seconds !== 0) {
          await db
            .update(dailyProjectActivityTable)
            .set({ hackatime_seconds: 0, updated_at: new Date() })
            .where(eq(dailyProjectActivityTable.id, existing.id));
          updatedRows += 1;
        }
        continue;
      }
      try {
        await setHackatimeSeconds(userId, project.id, day, total);
        updatedRows += 1;
      } catch (err) {
        console.error(
          `[daily-activity] setHackatimeSeconds failed for user=${userId} project=${project.id} day=${day}`,
          err,
        );
      }
    }
  }

  // Kept for signature stability; perDay keys are already tz-correct.
  void timezone;

  return { updatedRows };
}

export async function recomputeUserJournalActivity(
  userId: string,
  // null falls back to UTC
  timezone: string | null,
): Promise<{ updatedRows: number }> {
  // Scoped by author, not project owner, to match the live write path and not credit owners with teammates' journals.
  const rows = await db
    .select({
      project_id: journalsTable.project_id,
      hours: journalsTable.hours,
      created_at: journalsTable.created_at,
    })
    .from(journalsTable)
    .where(
      and(
        eq(journalsTable.user_id, userId),
        eq(journalsTable.archived, false),
      ),
    )
    .orderBy(asc(journalsTable.created_at));

  type Key = string;
  const totals = new Map<Key, { project_id: number; day: string; seconds: number }>();
  for (const row of rows) {
    if (!row.created_at) continue;
    const day = streakDayKey(row.created_at, timezone);
    const key: Key = `${row.project_id}${day}`;
    const seconds = hoursToSeconds(row.hours);
    const cur = totals.get(key);
    if (cur) {
      // Clamp the sum too, since several journals can exceed the per-day cap together.
      cur.seconds = Math.min(cur.seconds + seconds, MAX_DAILY_SECONDS_PER_PROJECT);
    } else {
      totals.set(key, { project_id: row.project_id, day, seconds });
    }
  }

  // Load existing rows to zero combos whose journals were all archived.
  const existingRows = await db
    .select({
      id: dailyProjectActivityTable.id,
      project_id: dailyProjectActivityTable.project_id,
      day: dailyProjectActivityTable.day,
      journal_seconds: dailyProjectActivityTable.journal_seconds,
    })
    .from(dailyProjectActivityTable)
    .where(eq(dailyProjectActivityTable.user_id, userId));

  let updatedRows = 0;
  const seen = new Set<string>();
  for (const row of existingRows) {
    const key: Key = `${row.project_id}${row.day}`;
    seen.add(key);
    const next = totals.get(key)?.seconds ?? 0;
    if (next === row.journal_seconds) continue;
    await db
      .update(dailyProjectActivityTable)
      .set({ journal_seconds: next, updated_at: new Date() })
      .where(eq(dailyProjectActivityTable.id, row.id));
    updatedRows += 1;
  }
  for (const [key, t] of totals) {
    if (seen.has(key)) continue;
    if (t.seconds === 0) continue;
    await db.insert(dailyProjectActivityTable).values({
      user_id: userId,
      project_id: t.project_id,
      day: t.day,
      journal_seconds: t.seconds,
      hackatime_seconds: 0,
    });
    updatedRows += 1;
  }
  return { updatedRows };
}

export async function backfillUserActivity(
  userId: string,
  accessToken: string | null,
  timezone: string | null,
): Promise<{
  journal_rows: number;
  hackatime_rows: number;
  failed_days: string[];
}> {
  let journalRows = 0;
  let hackatimeRows = 0;
  const failedDays: string[] = [];

  try {
    journalRows = (await recomputeUserJournalActivity(userId, timezone)).updatedRows;
  } catch (err) {
    console.error(`[daily-activity] journal recompute failed for ${userId}`, err);
  }

  if (accessToken) {
    try {
      // Include collab projects: only this user's own heartbeats are summed, so teammates' time is never credited.
      const projects = await db
        .selectDistinct({
          id: projectTable.id,
          hackatime_projects: projectTable.hackatime_projects,
          created_at: projectTable.created_at,
          deleted_at: projectTable.deleted_at,
        })
        .from(projectTable)
        .leftJoin(
          projectCollaboratorTable,
          and(
            eq(projectCollaboratorTable.project_id, projectTable.id),
            eq(projectCollaboratorTable.user_id, userId),
            eq(projectCollaboratorTable.status, "active"),
          ),
        )
        .where(
          or(
            eq(projectTable.user_id, userId),
            eq(projectCollaboratorTable.user_id, userId),
          ),
        );

      // Same floor as the streak code so DAU and streaks share per-day data.
      const startDay = MACONDO_HOURS_START_DATE;

      // Heartbeats give local-day keys; the cumulative fallback is UTC-keyed but works without an admin key.
      const [u] = await db
        .select({
          hackatime_id: users.hackatime_id,
          hackatime_api_status: users.hackatime_api_status,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // Skip dead tokens: the cumulative fallback would fan out one 401 per uncached day.
      if (!u || u.hackatime_api_status === "ok") {
        const config = useRuntimeConfig();
        const adminKey = (config.hackatimeAdminKey as string | undefined) ?? null;

        const fetched: PerProjectDailyResult =
          !!u?.hackatime_id && !!adminKey && !!timezone
            ? await fetchPerProjectDailyDurationsByLocalDay(
                u!.hackatime_id!,
                adminKey!,
                timezone!,
                startDay,
              )
            : await fetchPerProjectDailyDurations(
                userId,
                accessToken,
                timezone,
                startDay,
              );
        for (const d of fetched.failedDays) failedDays.push(d);

        hackatimeRows = (
          await recomputeUserHackatimeActivity(
            userId,
            timezone,
            fetched.perDay,
            fetched.beatsByDay,
            projects,
          )
        ).updatedRows;
      }
    } catch (err) {
      console.error(`[daily-activity] hackatime recompute failed for ${userId}`, err);
    }
  }

  // Self-heals streak_days desync by promoting stranded `pending` days; best-effort.
  try {
    await requalifyPendingStreakDaysForUser(userId, timezone);
  } catch (err) {
    console.error(`[daily-activity] streak requalify failed for ${userId}`, err);
  }

  return {
    journal_rows: journalRows,
    hackatime_rows: hackatimeRows,
    failed_days: failedDays,
  };
}

export type BatchActivityOutcome = {
  user_id: string;
  ok: boolean;
  reason?: string;
  journal_rows?: number;
  hackatime_rows?: number;
  failed_days?: number;
};

export type BatchActivityReport = {
  scanned: number;
  synced: number;
  failed: number;
  total_journal_rows: number;
  total_hackatime_rows: number;
  total_failed_days: number;
  failures: BatchActivityOutcome[];
  duration_ms: number;
};

export async function runBatchDailyActivityBackfill(opts?: {
  concurrency?: number;
}): Promise<BatchActivityReport> {
  const concurrency = Math.max(1, Math.min(20, opts?.concurrency ?? 5)); // clamp to 1-20 workers, default 5
  const startedAt = Date.now();

  const targets = await db
    .select({
      id: users.id,
      timezone: users.timezone,
      hackatime_oauth_token: users.hackatime_oauth_token,
    })
    .from(users)
    .where(eq(users.is_temp, false));

  const results: BatchActivityOutcome[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const target = targets[cursor++]!;
      try {
        const r = await backfillUserActivity(
          target.id,
          target.hackatime_oauth_token ?? null,
          target.timezone ?? null,
        );
        results.push({
          user_id: target.id,
          ok: true,
          journal_rows: r.journal_rows,
          hackatime_rows: r.hackatime_rows,
          failed_days: r.failed_days.length,
        });
      } catch (err) {
        console.error(`[daily-activity] backfill failed for ${target.id}`, err);
        results.push({
          user_id: target.id,
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, () => worker()),
  );

  const ok = results.filter((r) => r.ok).length;

  return {
    scanned: targets.length,
    synced: ok,
    failed: results.length - ok,
    total_journal_rows: results.reduce((n, r) => n + (r.journal_rows ?? 0), 0),
    total_hackatime_rows: results.reduce((n, r) => n + (r.hackatime_rows ?? 0), 0),
    total_failed_days: results.reduce((n, r) => n + (r.failed_days ?? 0), 0),
    failures: results.filter((r) => !r.ok).slice(0, 50), // cap failures listed in the report
    duration_ms: Date.now() - startedAt,
  };
}
