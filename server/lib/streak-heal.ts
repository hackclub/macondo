// Port of scripts/heal-streak-day.ts. Freezes the day (durable vs the reconcile), backs it
// with a net-zero freeze comp, and never touches last_active_date (that re-enrolls dormant users).
// Project streaks are restored only from the all_streaks_reset snapshot; writes are idempotent.
import { and, asc, eq, sql } from "drizzle-orm";
import { createError } from "h3";

import db from "../db";
import {
  auditLogTable,
  dailyProjectActivityTable,
  projectTable,
  streakDaysTable,
  users,
} from "../db/schema";
import { MAX_STREAK_FREEZES, streakToStage } from "./streaks";

const HEAL_ACTION = "streak_day_heal";
const GRANT_ACTION = "streak_freeze_grant";
const CONSUME_ACTION = "streak_freeze_consumed";

function shiftDay(dayStr: string, n: number): string {
  const d = new Date(dayStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayInTz(at: Date, tz: string | null): string {
  if (!tz) return at.toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

interface ProjSnapshot {
  id: number;
  project_streak_days: number;
}

export interface HealStreakDayInput {
  userId: string;
  day: string;
  actorId: string;
  reason?: string;
  now?: Date;
}

export interface HealStreakDayResult {
  status: "healed" | "noop";
  reason: string;
  day: string;
  prev_status: string | null;
  new_status: string | null;
  day_flipped: boolean;
  freeze_backed: boolean;
  projects_restored: number;
  projects_skipped: number;
}

export async function healStreakDay(
  input: HealStreakDayInput,
): Promise<HealStreakDayResult> {
  const { userId, actorId } = input;
  const day = input.day?.trim() ?? "";
  const reason =
    input.reason?.trim() ||
    "Support goodwill heal: short journal did not meet the 1 hour streak threshold; protected the day as frozen without charging a freeze.";
  const now = input.now ?? new Date();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid day; expected YYYY-MM-DD" });
  }

  const [user] = await db
    .select({
      id: users.id,
      timezone: users.timezone,
      last_active_date: users.last_active_date,
      streak_freezes_remaining: users.streak_freezes_remaining,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const todayLocal = dayInTz(now, user.timezone);
  if (day >= todayLocal) {
    throw createError({
      statusCode: 400,
      statusMessage: `Refusing: ${day} is today or in the future (user local today = ${todayLocal}). An in-progress day must not be frozen.`,
    });
  }

  // idempotency markers
  const [priorHeal] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.action, HEAL_ACTION),
        eq(auditLogTable.entity_type, "user"),
        eq(auditLogTable.entity_id, userId),
        sql`${auditLogTable.new_value}->>'day' = ${day}`,
      ),
    )
    .limit(1);
  const [backed] = await db
    .select({ id: auditLogTable.id })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.action, CONSUME_ACTION),
        eq(auditLogTable.entity_type, "user"),
        eq(auditLogTable.entity_id, userId),
        sql`jsonb_typeof(${auditLogTable.new_value}->'frozen_days') = 'array'`,
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${auditLogTable.new_value}->'frozen_days') d WHERE d = ${day})`,
      ),
    )
    .limit(1);
  const backedAlready = !!backed;

  const [existing] = await db
    .select({ status: streakDaysTable.status })
    .from(streakDaysTable)
    .where(and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, day)))
    .limit(1);
  const prevStatus = existing?.status ?? null;

  if (prevStatus === "active") {
    return noop("Day already qualified on its own (active); nothing to heal.", day, prevStatus);
  }
  if (prevStatus === "review_protected") {
    return noop("Day is review_protected (held by a ship in review); left as-is.", day, prevStatus);
  }

  const needFlip = prevStatus === "pending" || prevStatus === "missed" || prevStatus === null;
  const needBacking = !backedAlready;
  if (!needFlip && !needBacking) {
    return noop("Already frozen and freeze-backed for this day. Nothing to do.", day, prevStatus);
  }

  // only restore if an all_streaks_reset listed THIS day, and only projects still at zero
  const [resetForDay] = await db
    .select({ old_value: auditLogTable.old_value })
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.action, "all_streaks_reset"),
        eq(auditLogTable.entity_type, "user"),
        eq(auditLogTable.entity_id, userId),
        sql`jsonb_typeof(${auditLogTable.new_value}->'missed_days') = 'array'`,
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${auditLogTable.new_value}->'missed_days') d WHERE d = ${day})`,
      ),
    )
    .orderBy(asc(auditLogTable.created_at))
    .limit(1);

  const currentProjects = await db
    .select({
      id: projectTable.id,
      project_streak_days: projectTable.project_streak_days,
      last_worked_date: projectTable.last_worked_date,
    })
    .from(projectTable)
    .where(eq(projectTable.user_id, userId));
  const projById = new Map(currentProjects.map((p) => [p.id, p]));

  const restores: Array<{
    id: number;
    to: number;
    stage: number;
    last_worked: string;
    restorable: boolean;
  }> = [];
  for (const snap of (resetForDay?.old_value as { projects?: ProjSnapshot[] } | null)?.projects ?? []) {
    if (!snap || snap.project_streak_days <= 0) continue;
    const cur = projById.get(snap.id);
    const [lw] = await db
      .select({ last_worked: sql<string | null>`MAX(${dailyProjectActivityTable.day})` })
      .from(dailyProjectActivityTable)
      .where(
        and(
          eq(dailyProjectActivityTable.project_id, snap.id),
          sql`${dailyProjectActivityTable.day} < ${day}`,
          sql`(${dailyProjectActivityTable.journal_seconds} + ${dailyProjectActivityTable.hackatime_seconds}) >= ${3600}`, // one hour in seconds
        ),
      );
    restores.push({
      id: snap.id,
      to: snap.project_streak_days,
      stage: streakToStage(snap.project_streak_days),
      last_worked: lw?.last_worked ?? shiftDay(day, -1),
      restorable: !!cur && cur.project_streak_days === 0 && cur.last_worked_date === null,
    });
  }

  const curFreezes = user.streak_freezes_remaining;
  let dayFlipped = false;
  let projRestored = 0;
  let projSkipped = 0;
  let backingWritten = false;

  await db.transaction(async (tx) => {
    if (needFlip) {
      if (prevStatus === "missed" || prevStatus === "pending") {
        dayFlipped =
          (
            await tx
              .update(streakDaysTable)
              .set({ status: "frozen", updated_at: new Date() })
              .where(
                and(
                  eq(streakDaysTable.user_id, userId),
                  eq(streakDaysTable.day, day),
                  eq(streakDaysTable.status, prevStatus),
                ),
              )
              .returning({ id: streakDaysTable.id })
          ).length > 0;
      } else {
        dayFlipped =
          (
            await tx
              .insert(streakDaysTable)
              .values({ user_id: userId, day, status: "frozen", seconds_logged: 0, had_journal: false })
              .onConflictDoNothing({ target: [streakDaysTable.user_id, streakDaysTable.day] })
              .returning({ id: streakDaysTable.id })
          ).length > 0;
      }
    }

    for (const r of restores) {
      const res = await tx
        .update(projectTable)
        .set({
          project_streak_days: r.to,
          stage: r.stage,
          last_worked_date: r.last_worked,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(projectTable.id, r.id),
            eq(projectTable.project_streak_days, 0),
            sql`${projectTable.last_worked_date} IS NULL`,
          ),
        )
        .returning({ id: projectTable.id });
      if (res.length > 0) projRestored += 1;
      else projSkipped += 1;
    }

    // ordering keeps the balance within [0, MAX]: give-then-use below the cap, use-then-give at it
    if (needBacking) {
      const [lock] = await tx
        .select({ f: users.streak_freezes_remaining })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      const before = Number(lock?.f ?? 0);
      let grantOld: number;
      let grantNew: number;
      let consumeOld: number;
      let consumeNew: number;
      if (before < MAX_STREAK_FREEZES) {
        grantOld = before;
        grantNew = before + 1;
        await tx.update(users).set({ streak_freezes_remaining: grantNew }).where(eq(users.id, userId));
        consumeOld = grantNew;
        consumeNew = grantNew - 1;
        await tx.update(users).set({ streak_freezes_remaining: consumeNew }).where(eq(users.id, userId));
      } else {
        consumeOld = before;
        consumeNew = before - 1;
        await tx.update(users).set({ streak_freezes_remaining: consumeNew }).where(eq(users.id, userId));
        grantOld = consumeNew;
        grantNew = consumeNew + 1;
        await tx.update(users).set({ streak_freezes_remaining: grantNew }).where(eq(users.id, userId));
      }
      await tx.insert(auditLogTable).values({
        actor_id: actorId,
        action: GRANT_ACTION,
        entity_type: "user",
        entity_id: userId,
        old_value: { freezes: grantOld },
        new_value: { freezes: grantNew, heal_day: day, source: "manual_streak_heal", reason, via: "mcp" },
        sensitive: true,
        public_message: `Comped 1 streak freeze to back healed day ${day}.`,
        change_summary: GRANT_ACTION,
      });
      await tx.insert(auditLogTable).values({
        actor_id: actorId,
        action: CONSUME_ACTION,
        entity_type: "user",
        entity_id: userId,
        old_value: { freezes: consumeOld, last_active_date: user.last_active_date },
        new_value: { freezes: consumeNew, frozen_days: [day], heal_day: day, source: "manual_streak_heal" },
        sensitive: true,
        public_message: `Used 1 streak freeze to protect ${day} (manual heal, net zero with the comp above).`,
        change_summary: "streak_freeze_auto_consume",
      });
      backingWritten = true;
    }

    // a re-run that only adds backing must not duplicate this
    if (!priorHeal) {
      await tx.insert(auditLogTable).values({
        actor_id: actorId,
        action: HEAL_ACTION,
        entity_type: "user",
        entity_id: userId,
        old_value: {
          day,
          prev_status: prevStatus,
          streak_freezes_remaining: curFreezes,
          last_active_date: user.last_active_date,
          projects: restores.filter((r) => r.restorable).map((r) => ({ id: r.id })),
        },
        new_value: {
          day,
          new_status: "frozen",
          freeze_backed: true,
          streak_freezes_remaining: curFreezes,
          last_active_date: user.last_active_date,
          projects_restored: restores
            .filter((r) => r.restorable)
            .map((r) => ({ id: r.id, project_streak_days: r.to, stage: r.stage, last_worked_date: r.last_worked })),
          reason,
          via: "mcp",
        },
        sensitive: true,
        public_message: `Healed streak day ${day}: ${reason}`,
        change_summary: HEAL_ACTION,
      });
    }
  });

  return {
    status: "healed",
    reason,
    day,
    prev_status: prevStatus,
    new_status: "frozen",
    day_flipped: dayFlipped,
    freeze_backed: backingWritten || backedAlready,
    projects_restored: projRestored,
    projects_skipped: projSkipped,
  };
}

function noop(reason: string, day: string, prevStatus: string | null): HealStreakDayResult {
  return {
    status: "noop",
    reason,
    day,
    prev_status: prevStatus,
    new_status: prevStatus,
    day_flipped: false,
    freeze_backed: false,
    projects_restored: 0,
    projects_skipped: 0,
  };
}
