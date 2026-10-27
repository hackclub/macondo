import { eq } from "drizzle-orm";
import db from "../../db";
import { users, hackatimeSyncAuditTable } from "../../db/schema";
import { recomputeUserJournalActivity } from "../../lib/daily-activity";
import { getEffectiveHackatimeOAuthToken } from "../../lib/dev-debug-flags";
import {
  classifyHackatimeAuthFailure,
  getAuthenticatedHours,
  syncHackatimeTimezone,
} from "../../lib/hackatime";
import { getSession } from "../../lib/session";
import {
  extendProjectStreaksFromHackatime,
  extendStreak,
  getActiveTeamProjectIdsForMember,
  getUserLinkedHackatimeSecondsToday,
  recomputeTeamProjectStreak,
  requalifyPendingStreakDaysForUser,
} from "../../lib/streaks";
import { macondoHasEnded } from "../../lib/macondo-end";

// Journal recompute is reported separately so a refresh with hackatime down still succeeds.
type HackatimeSyncResult =
  | { linked: false; reason: "not_linked" }
  | { linked: true; reason: "debounced" | "fetch_failed" | "token_dead" }
  | {
      linked: true;
      total_hours: number;
      delta_hours: number;
      delta_seconds: number;
      extended_streak: boolean;
    };

export default defineEventHandler(async (event) => {
  const sessionUser = await getSession(event);
  if (!sessionUser) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }
  const userId = sessionUser.id;

  // Every open tab calls this every few minutes; after the event the journal recompute,
  // Hackatime fetch and streak writes it triggers are pure database load.
  if (macondoHasEnded()) {
    return {
      ok: true as const,
      journal_recomputed: false,
      hackatime: { linked: true, reason: "debounced" as const },
    };
  }

  const [targetRow] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!targetRow) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  // Non-null const so narrowing survives inside the runHackatimeSync closure.
  const target = targetRow;

  const timezone = target.timezone ?? null;

  // `?manual=1` is the refresh button; the per-minute background sync only recomputes
  // journals once the debounce window has elapsed.
  const manual = getQuery(event).manual === "1";
  const debounced = !!(
    target.last_hackatime_synced_at &&
    Date.now() - target.last_hackatime_synced_at.getTime() < 5 * 60 * 1000 // resync debounce window
  );

  // Runs before hackatime so journaling counts regardless of it. Best-effort: never fails the request.
  let journalRecomputed = false;
  if (manual || !debounced) {
    try {
      await recomputeUserJournalActivity(userId, timezone);
      await requalifyPendingStreakDaysForUser(userId, timezone);
      journalRecomputed = true;
    } catch (err) {
      console.error("[users/sync-hackatime] journal recompute failed", err);
    }
  }

  // A failing upstream must never 502; the debounce gates manual clicks too, to protect the upstream.
  const hackatimeToken = getEffectiveHackatimeOAuthToken(
    event,
    target.hackatime_oauth_token,
  );

  async function runHackatimeSync(token: string): Promise<HackatimeSyncResult> {
    const hours = await getAuthenticatedHours(token);
    if (!hours) {
      // Persist a definitive verdict so sweeps stop hammering a dead token. A dev-debug
      // override must never mark the row, and transient ("unknown") failures stay unmarked.
      if (
        token === target.hackatime_oauth_token &&
        target.hackatime_api_status === "ok"
      ) {
        const failure = await classifyHackatimeAuthFailure(token);
        if (failure !== "unknown") {
          try {
            await db
              .update(users)
              .set({
                hackatime_api_status: failure,
                hackatime_api_status_changed_at: new Date(),
              })
              .where(eq(users.id, userId));
          } catch (err) {
            console.error(
              "[users/sync-hackatime] failed to mark hackatime_api_status",
              err,
            );
          }
          return { linked: true, reason: "token_dead" as const };
        }
      }
      return { linked: true, reason: "fetch_failed" as const };
    }

    const totalSeconds = Math.max(0, Math.floor(hours.total_seconds ?? 0));
    const totalHours = Math.round((totalSeconds / 3600) * 100) / 100; // hours rounded to 2 decimals
    // Seconds so sub-hour activity counts. Missing seconds fall back to legacy hours so
    // accumulated history isn't a one-time spurious streak credit.
    const isFirstSync = target.last_hackatime_synced_at === null;
    const previousSecondsRaw = target.last_hackatime_total_seconds;
    const previousSeconds =
      previousSecondsRaw == null
        ? Math.round((target.last_hackatime_total_hours ?? 0) * 3600)
        : previousSecondsRaw;
    const deltaSeconds = isFirstSync
      ? 0
      : Math.max(0, totalSeconds - previousSeconds);
    const deltaHours = Math.round((deltaSeconds / 3600) * 100) / 100;
    const now = new Date();

    await db
      .update(users)
      .set({
        last_hackatime_total_hours: totalHours,
        last_hackatime_total_seconds: totalSeconds,
        last_hackatime_synced_at: now,
      })
      .where(eq(users.id, userId));

    // Hackatime's timezone is authoritative; no-op when it has none.
    const effectiveTz =
      (await syncHackatimeTimezone({
        userId: userId,
        hackatimeId: target.hackatime_id ?? null,
        adminKey: (useRuntimeConfig().hackatimeAdminKey as string | undefined) ?? null,
        currentTimezone: target.timezone ?? null,
        currentHackatimeTimezone: target.hackatime_timezone ?? null,
      })) ??
      target.timezone ??
      null;

    let extended = false;
    if (!isFirstSync && deltaSeconds > 0) {
      // Anti-cheese: only work on hackatime projects linked to a lynx project extends the streak.
      try {
        const linkedSecondsToday = await getUserLinkedHackatimeSecondsToday(
          userId,
        );
        if (linkedSecondsToday > 0) {
          extended = (await extendStreak(userId, "hackatime", linkedSecondsToday)).activated;
        }
      } catch (err) {
        console.error("[users/sync-hackatime] extendStreak failed", err);
      }
      try {
        await extendProjectStreaksFromHackatime(
          userId,
          token,
          effectiveTz,
        );
      } catch (err) {
        console.error(
          "[users/sync-hackatime] extendProjectStreaksFromHackatime failed",
          err,
        );
      }
      // The per-user extend skips team projects; this is idempotent, so safe on every sync.
      try {
        for (const pid of await getActiveTeamProjectIdsForMember(userId)) {
          try {
            await recomputeTeamProjectStreak(pid);
          } catch (err) {
            console.error(
              `[users/sync-hackatime] recomputeTeamProjectStreak ${pid} failed`,
              err,
            );
          }
        }
      } catch (err) {
        console.error("[users/sync-hackatime] team streak recompute failed", err);
      }
    }

    await db.insert(hackatimeSyncAuditTable).values({
      user_id: userId,
      total_hours: totalHours,
      delta_hours: deltaHours,
      sync_date: now.toISOString().slice(0, 10), // yyyy-mm-dd
      extended_streak: extended,
      source: isFirstSync ? "first_sync_seed" : "dashboard_auto",
    });

    return {
      linked: true,
      total_hours: totalHours,
      delta_hours: deltaHours,
      delta_seconds: deltaSeconds,
      extended_streak: extended,
    };
  }

  let hackatime: HackatimeSyncResult;
  if (!hackatimeToken) {
    hackatime = { linked: false, reason: "not_linked" };
  } else if (
    target.hackatime_api_status !== "ok" &&
    hackatimeToken === target.hackatime_oauth_token
  ) {
    // Dead tokens never advance the debounce, so skip the doomed call; a batch sync or re-link clears the mark.
    hackatime = { linked: true, reason: "token_dead" };
  } else if (debounced) {
    hackatime = { linked: true, reason: "debounced" };
  } else {
    try {
      hackatime = await runHackatimeSync(hackatimeToken);
    } catch (err) {
      // The journal recompute already updated the streak.
      console.error("[users/sync-hackatime] hackatime sync failed", err);
      hackatime = { linked: true, reason: "fetch_failed" };
    }
  }

  return {
    ok: true as const,
    journal_recomputed: journalRecomputed,
    hackatime,
  };
});
