// gated to once per 7 days per user (not per project) via an audit lookback.
// may fire the same day as streak-reminders.ts; that is intentional.

import { and, asc, desc, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import db from "../db";
import {
  users,
  projectTable,
  journalsTable,
  auditLogTable,
} from "../db/schema";
import { getProjectsProtectedByActiveReview, streakDayKey } from "./streaks";
import { macondoHasEnded } from "./macondo-end";
import { dm } from "./slack-bot";

// mirrors streak-reminders.ts, kept local so the two paths don't import each other
function reminderTargetLocalHour(hoursBeforeDayEnd: number): number {
  return (24 - Math.max(1, Math.min(23, Math.floor(hoursBeforeDayEnd)))) % 24;
}

// falls back to UTC for null/invalid zones so a bad row never blocks the reminder
function localHourInTz(at: Date, tz: string | null | undefined): number {
  if (!tz) return at.getUTCHours();
  try {
    const raw = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(at).find((p) => p.type === "hour")?.value ?? "0";
    const h = parseInt(raw, 10);
    return Number.isFinite(h) ? h % 24 : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}

const NAME_LIST_LIMIT = 10;

type SingleTemplate = (name: string) => string;
type MultiTemplate = (count: number, listed: string) => string;

const SINGLE_PROJECT_VARIANTS: SingleTemplate[] = [
  (name) => `your project ${name} is still at no streak. one logged hour today gets one going.`,
  (name) => `${name} is sitting at zero streak. an hour of logged code or journaled work kicks one off.`,
  (name) => `no streak going on ${name} yet. spend a logged hour on it today to start.`,
  (name) => `${name} hasn't earned a streak yet. one logged hour today gets it rolling.`,
  (name) => `want to kick off a streak on ${name}? an hour logged today does it.`,
  (name) => `capybara has been thinking about ${name}. one logged hour today would kick off its first streak.`,
  (name) => `psst, ${name} is still waiting on its first streak. an hour of logged work today gets one going.`,
  (name) => `capybara would love to see ${name} get a streak. one logged hour today is all it takes.`,
];

const MULTI_PROJECT_VARIANTS: MultiTemplate[] = [
  (count, listed) => `you have ${count} projects sitting at no streak: ${listed}. one logged hour on any of them today gets one going.`,
  (count, listed) => `${count} of your projects are at zero streak (${listed}). an hour of logged code or journaled work on any of them kicks one off.`,
  (count, listed) => `${count} idle projects ready to revive: ${listed}. one logged hour on any of them starts a streak today.`,
  (count, listed) => `${count} projects (${listed}) are still at no streak. log an hour on any of them today and one starts.`,
  (count, listed) => `${count} of your projects haven't started streaks yet: ${listed}. an hour of logged work today gets one rolling.`,
  (count, listed) => `capybara noticed ${count} of your projects haven't started streaks yet: ${listed}. one logged hour on any of them today kicks one off.`,
  (count, listed) => `soft nudge from capybara, ${count} projects (${listed}) are still streak-less. an hour logged on any of them today gets one rolling.`,
  (count, listed) => `${count} projects on your list (${listed}) haven't qualified for a streak yet. no pressure, one logged hour on any of them starts one today.`,
];

function buildMessage(
  slackId: string,
  names: string[],
  excludeIndex: number | null,
): { text: string; index: number; pool: "single" | "multi" } {
  let listed: string;
  if (names.length <= NAME_LIST_LIMIT) {
    listed = names.join(", ");
  } else {
    listed = `${names.slice(0, NAME_LIST_LIMIT).join(", ")}, and ${names.length - NAME_LIST_LIMIT} more`;
  }

  if (names.length === 1) {
    const pool: number[] = [];
    for (let i = 0; i < SINGLE_PROJECT_VARIANTS.length; i++) {
      if (i !== excludeIndex) pool.push(i);
    }
    const index = pool[Math.floor(Math.random() * pool.length)]!;
    return { text: `hey <@${slackId}>, ${SINGLE_PROJECT_VARIANTS[index]!(names[0]!)}`, index, pool: "single" };
  }

  const pool: number[] = [];
  for (let i = 0; i < MULTI_PROJECT_VARIANTS.length; i++) {
    if (i !== excludeIndex) pool.push(i);
  }
  const index = pool[Math.floor(Math.random() * pool.length)]!;
  return { text: `hey <@${slackId}>, ${MULTI_PROJECT_VARIANTS[index]!(names.length, listed)}`, index, pool: "multi" };
}

export interface ZeroStreakReminderResult {
  // every counter is 0 when true
  skipped_event_over: boolean;
  scanned: number;
  candidates: number;
  sent: number;
  skipped_existing_audit: number;
  skipped_no_zero_projects: number;
  skipped_all_zero_projects_in_review: number;
}

const USER_BATCH_SIZE = 250;

export async function sendDueZeroStreakReminders(
  options: { hourOverride?: number; force?: boolean } = {},
): Promise<ZeroStreakReminderResult> {
  if (macondoHasEnded() && !options.force) {
    return {
      skipped_event_over: true,
      scanned: 0,
      candidates: 0,
      sent: 0,
      skipped_existing_audit: 0,
      skipped_no_zero_projects: 0,
      skipped_all_zero_projects_in_review: 0,
    };
  }

  let scanned = 0;
  let candidates = 0;
  let sent = 0;
  let skippedExistingAudit = 0;
  let skippedNoZeroProjects = 0;
  let skippedAllZeroProjectsInReview = 0;

  const now = new Date();
  // the audit row is only written on a successful send, so users without candidates don't start the clock
  const auditLookback = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  // hourOverride is a local target hour; cron runs hourly UTC but compares each user's local clock
  const forcedTargetLocalHour = options.hourOverride;

  let cursor: string | null = null;
  while (true) {
  const targets = await db
    .select({
      id: users.id,
      name: users.name,
      slack_id: users.slack_id,
      timezone: users.timezone,
      reminder_hours_before_day_end: users.reminder_hours_before_day_end,
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
    const targetLocalHour = reminderTargetLocalHour(u.reminder_hours_before_day_end);
    const userLocalHour = localHourInTz(now, u.timezone);
    const fires = forcedTargetLocalHour !== undefined
      ? forcedTargetLocalHour === targetLocalHour
      : userLocalHour === targetLocalHour;
    if (!fires) continue;
    candidates += 1;

    const today = streakDayKey(now, u.timezone);

    // no hackatime and no journal means a probably-abandoned project we shouldn't nag about
    const validZero = await db
      .select({
        id: projectTable.id,
        name: projectTable.name,
      })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.user_id, u.id),
          eq(projectTable.project_streak_days, 0),
          or(
            and(
              isNotNull(projectTable.hackatime_projects),
              sql`array_length(${projectTable.hackatime_projects}, 1) > 0`,
            ),
            sql`EXISTS (SELECT 1 FROM ${journalsTable} j WHERE j.project_id = ${projectTable.id})`,
          ),
        ),
      );

    if (validZero.length === 0) {
      skippedNoZeroProjects += 1;
      continue;
    }

    // streaks are protected while in review, so nudging about those projects would mislead
    const protectedIds = await getProjectsProtectedByActiveReview(u.id);
    const filteredZero = validZero.filter((p) => !protectedIds.has(p.id));
    if (filteredZero.length === 0) {
      skippedAllZeroProjectsInReview += 1;
      continue;
    }

    // also remembers the last variant so consecutive sends don't repeat it
    const [lastSent] = await db
      .select({
        created_at: auditLogTable.created_at,
        new_value: auditLogTable.new_value,
      })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.actor_id, u.id),
          eq(auditLogTable.action, "zero_streak_reminder_sent"),
        ),
      )
      .orderBy(desc(auditLogTable.created_at))
      .limit(1);

    if (lastSent && lastSent.created_at >= auditLookback) {
      skippedExistingAudit += 1;
      continue;
    }

    const projectIds = filteredZero.map((p) => p.id);
    const projectNames = filteredZero.map((p) => p.name);
    const lastNewValue = lastSent?.new_value as
      | { variant_pool?: unknown; variant_index?: unknown }
      | null;
    const lastIndex =
      lastNewValue?.variant_pool === (projectNames.length === 1 ? "single" : "multi") &&
      typeof lastNewValue?.variant_index === "number"
        ? (lastNewValue.variant_index as number)
        : null;

    const { text, index, pool } = buildMessage(
      u.slack_id!,
      projectNames,
      lastIndex,
    );

    try {
      const result = await dm({ user: u.slack_id!, text });
      if (!result.ok) {
        console.warn(
          `[zero-streak-reminder] dm failed for user ${u.id}: ${result.error}`,
        );
        continue;
      }
      await db.insert(auditLogTable).values({
        actor_id: u.id,
        action: "zero_streak_reminder_sent",
        entity_type: "user",
        entity_id: u.id,
        old_value: null,
        new_value: {
          day: today,
          local_hour: userLocalHour,
          hours_before_day_end: u.reminder_hours_before_day_end,
          project_ids: projectIds,
          project_count: projectIds.length,
          variant_pool: pool,
          variant_index: index,
        },
        sensitive: false,
        public_message: `Sent zero-streak reminder DM to ${u.name ?? u.id} (${projectIds.length} project${projectIds.length === 1 ? "" : "s"})`,
        change_summary: "zero_streak_reminder_dm",
      });
      sent += 1;
    } catch (err) {
      console.error(`[zero-streak-reminder] send failed for user ${u.id}`, err);
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
    skipped_no_zero_projects: skippedNoZeroProjects,
    skipped_all_zero_projects_in_review: skippedAllZeroProjectsInReview,
  };
}
