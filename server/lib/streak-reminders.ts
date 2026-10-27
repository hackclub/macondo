import { and, asc, desc, eq, gt, isNotNull } from "drizzle-orm";
import db from "../db";
import {
  users,
  projectTable,
  streakDaysTable,
  auditLogTable,
} from "../db/schema";
import {
  extendProjectStreaksFromHackatime,
  getProjectsProtectedByActiveReview,
  streakDayKey,
  USER_STREAK_THRESHOLD_SECONDS,
} from "./streaks";
import { dayQualifiesForUserStreak, yesterdayStr } from "./streak-helpers";
import { getUserCombinedSecondsForDay } from "./daily-activity";
import { macondoHasEnded } from "./macondo-end";
import { dm } from "./slack-bot";

// Streak day ends at local midnight, so N=1 fires at 23:00 and N=8 at 16:00.
function reminderTargetLocalHour(hoursBeforeDayEnd: number): number {
  return (24 - Math.max(1, Math.min(23, Math.floor(hoursBeforeDayEnd)))) % 24;
}

// Falls back to UTC so a bad timezone row never blocks the reminder.
function localHourInTz(at: Date, tz: string | null | undefined): number {
  if (!tz) return at.getUTCHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    return Number.isFinite(h) ? h % 24 : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}

const REMINDER_VARIANTS = [
  "your project streaks are on the line. log at least 1 hour on a project before today's streak day rolls.",
  "just a heads up: you haven't qualified for today's streak yet. 1 logged hour of work locks it in.",
  "don't lose your streaks today. log an hour on any project and you're good.",
  "reminder: today's streak isn't locked yet. one logged hour of coding or journaled work does it.",
  "your project streaks are still standing but today's under an hour. lock them in before the day rolls.",
  "tick tock, today's streak is still up for grabs. one logged hour saves it.",
  "still time to keep the streak going. an hour of logged work today and you're set.",
  "your streak is hanging by a thread today. log an hour of code or journaled work to keep it alive.",
  "haven't seen an hour logged from you yet today. 60 minutes of code or journaled work gets the streak locked in.",
  "the day's almost over and the streak isn't safe yet. one logged hour does the trick.",
  "psst, your streak wants to live. an hour of coding or journaled work and it's yours for another day.",
  "today's streak is unfinished business. an hour of logged work on a project seals it.",
  "no streak qualified for today yet. one logged hour on any project and you're good to go.",
  "your project streaks are still alive but they need time today. an hour of code or journaled work will do it.",
  "before the day rolls, today's streak is still open. one logged hour closes it out.",
  "fyi the streak isn't safe yet. spend an hour on a project to lock today in.",
  "your streak is waiting on you. an hour of logged work today and it carries forward.",
  "almost there, today's streak just needs one logged hour to count.",
  "you've got hours left to lock today in. one hour logged on any project does it.",
  "don't let the streak slip. an hour of logged work on any project keeps it alive.",
  "capybara is gently nudging you about today's streak. one logged hour on any project locks it in.",
  "no pressure, but capybara would be very happy if today's streak qualified. an hour of logged work does it.",
  "capybara hopes you're having a good day, and also that today's streak gets an hour logged before it rolls.",
  "capybara is rooting for you. today's streak is still up for grabs, one logged hour seals it.",
  "capybara has been napping all afternoon but woke up to remind you, today's streak isn't locked yet. an hour logged fixes that.",
  "soft check-in: today hasn't qualified yet. one logged hour on any project takes care of it.",
  "in case the day got away from you (it happens), today's streak is still open. one logged hour locks it.",
  "low-key reminder, your streak is still waiting on today. an hour of logged work on any project carries it forward.",
  "no rush, just a heads up that today's streak hasn't qualified. log one hour before the day rolls.",
  "haven't seen an hour of activity from you today, but no judgment. one logged hour on any project keeps the streak rolling.",
];

function pickVariant(
  slackId: string,
  excludeIndex: number | null,
): { text: string; index: number } {
  const pool: number[] = [];
  for (let i = 0; i < REMINDER_VARIANTS.length; i++) {
    if (i !== excludeIndex) pool.push(i);
  }
  const index = pool[Math.floor(Math.random() * pool.length)]!;
  return { text: `hey <@${slackId}>, ${REMINDER_VARIANTS[index]}`, index };
}

export interface ReminderResult {
  skipped_event_over: boolean;
  scanned: number;
  candidates: number;
  sent: number;
  skipped_existing_audit: number;
  skipped_already_qualified: number;
  skipped_all_streaks_in_review: number;
}

// Bounds the per-tick working set; any small batch size works.
const USER_BATCH_SIZE = 250;

export async function sendDueReminders(
  options: { hourOverride?: number; force?: boolean } = {},
): Promise<ReminderResult> {
  // Only the supaadmin manual trigger can force past this (staff testing).
  if (macondoHasEnded() && !options.force) {
    return {
      skipped_event_over: true,
      scanned: 0,
      candidates: 0,
      sent: 0,
      skipped_existing_audit: 0,
      skipped_already_qualified: 0,
      skipped_all_streaks_in_review: 0,
    };
  }

  let scanned = 0;
  let candidates = 0;
  let sent = 0;
  let skippedExistingAudit = 0;
  let skippedAlreadyQualified = 0;
  let skippedAllStreaksInReview = 0;

  const now = new Date();
  // Users can pick several reminder hours an hour apart, so only dedupe within 45 minutes.
  const auditLookback = new Date(now.getTime() - 45 * 60 * 1000);
  // hourOverride is the LOCAL target hour the admin force-fire endpoint wants matched.
  const forcedTargetLocalHour = options.hourOverride;

  let cursor: string | null = null;
  while (true) {
  const targets = await db
    .select({
      id: users.id,
      name: users.name,
      slack_id: users.slack_id,
      timezone: users.timezone,
      hackatime_oauth_token: users.hackatime_oauth_token,
      reminder_hours_before_day_end: users.reminder_hours_before_day_end,
      reminder_local_hours: users.reminder_local_hours,
      streak_slack_notifications: users.streak_slack_notifications,
    })
    .from(users)
    .where(
      and(
        eq(users.streak_slack_notifications, true),
        isNotNull(users.slack_id),
        cursor ? gt(users.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(users.id))
    .limit(USER_BATCH_SIZE);
  if (targets.length === 0) break;
  scanned += targets.length;
  cursor = targets[targets.length - 1]!.id;

  for (const u of targets) {
    const userLocalHour = localHourInTz(now, u.timezone);
    const targetHours =
      u.reminder_local_hours && u.reminder_local_hours.length > 0
        ? u.reminder_local_hours
        : [reminderTargetLocalHour(u.reminder_hours_before_day_end)];
    const fires =
      forcedTargetLocalHour !== undefined
        ? targetHours.includes(forcedTargetLocalHour)
        : targetHours.includes(userLocalHour);
    if (!fires) continue;
    candidates += 1;

    const today = streakDayKey(now, u.timezone);
    const yesterday = yesterdayStr(today);

    // Only projects last worked today or yesterday can be lost by inaction today; older ones are dormant.
    // Day keys are YYYY-MM-DD in the user's tz, so a string compare works.
    const currentStreakProjects = (
      await db
        .select({
          id: projectTable.id,
          last_worked_date: projectTable.last_worked_date,
        })
        .from(projectTable)
        .where(
          and(
            eq(projectTable.user_id, u.id),
            gt(projectTable.project_streak_days, 0),
          ),
        )
    ).filter(
      (p) => p.last_worked_date != null && p.last_worked_date >= yesterday,
    );
    if (currentStreakProjects.length === 0) continue;

    // Review-loop projects are protected from the daily reset, so a reminder would mislead.
    const protectedIds = await getProjectsProtectedByActiveReview(u.id);
    if (
      currentStreakProjects.filter((p) => !protectedIds.has(p.id)).length === 0
    ) {
      skippedAllStreaksInReview += 1;
      continue;
    }

    // Measure the user's local day from daily_project_activity: Hackatime's day endpoint reads UTC
    // midnight and false-qualified users west of UTC.
    const [todayRow] = await db
      .select({ status: streakDaysTable.status })
      .from(streakDaysTable)
      .where(
        and(
          eq(streakDaysTable.user_id, u.id),
          eq(streakDaysTable.day, today),
        ),
      )
      .limit(1);
    let qualifiedToday = todayRow?.status === "active";

    if (!qualifiedToday) {
      // Best effort: a hackatime outage must never block the reminder.
      if (u.hackatime_oauth_token) {
        try {
          await extendProjectStreaksFromHackatime(
            u.id,
            u.hackatime_oauth_token,
            u.timezone,
          );
        } catch (err) {
          console.error(
            `[streak-reminder] hackatime refresh failed for ${u.id}`,
            err,
          );
        }
      }
      try {
        // The combined read already includes journals, so journalSeconds stays 0 to avoid double counting.
        if (
          dayQualifiesForUserStreak({
            hackatimeSeconds: await getUserCombinedSecondsForDay(u.id, today),
            journalSeconds: 0,
            threshold: USER_STREAK_THRESHOLD_SECONDS,
          })
        ) {
          qualifiedToday = true;
        }
      } catch (err) {
        console.error(
          `[streak-reminder] local-day qualify check failed for ${u.id}`,
          err,
        );
      }
    }

    if (qualifiedToday) {
      skippedAlreadyQualified += 1;
      continue;
    }

    // One lookup serves both the dedupe gate and not repeating the last variant.
    const [lastSent] = await db
      .select({
        created_at: auditLogTable.created_at,
        new_value: auditLogTable.new_value,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actor_id, u.id),
          eq(auditLogTable.action, "streak_reminder_sent"),
        ),
      )
      .orderBy(desc(auditLogTable.created_at))
      .limit(1);

    if (lastSent && lastSent.created_at >= auditLookback) {
      skippedExistingAudit += 1;
      continue;
    }

    const lastVariantRaw = (lastSent?.new_value as { variant_index?: unknown } | null)
      ?.variant_index;

    const { text, index } = pickVariant(
      u.slack_id!,
      typeof lastVariantRaw === "number" ? lastVariantRaw : null,
    );
    try {
      const result = await dm({ user: u.slack_id!, text });
      if (!result.ok) {
        console.warn(
          `[streak-reminder] dm failed for user ${u.id}: ${result.error}`,
        );
        continue;
      }
      await db.insert(auditLogTable).values({
        actor_id: u.id,
        action: "streak_reminder_sent",
        entity_type: "user",
        entity_id: u.id,
        old_value: null,
        new_value: {
          day: today,
          local_hour: userLocalHour,
          hours_before_day_end: u.reminder_hours_before_day_end,
          variant_index: index,
        },
        sensitive: false,
        public_message: `Sent streak reminder DM to ${u.name ?? u.id}`,
        change_summary: "streak_reminder_dm",
      });
      sent += 1;
    } catch (err) {
      console.error(`[streak-reminder] send failed for user ${u.id}`, err);
    }
  }

  if (targets.length < USER_BATCH_SIZE) break;
  }

  return {
    skipped_event_over: false,
    scanned,
    candidates,
    sent,
    skipped_existing_audit: skippedExistingAudit,
    skipped_already_qualified: skippedAlreadyQualified,
    skipped_all_streaks_in_review: skippedAllStreaksInReview,
  };
}
