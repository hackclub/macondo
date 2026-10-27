// The cron polls every 5 minutes over a 25-35m band, so one missed tick is still covered.
// Bounds are ISO strings cast to timestamp; a raw Date in a Drizzle sql template crashes postgres-js.

import { and, eq, isNull, sql } from "drizzle-orm";

import db from "../db";
import { eventAttendeeTable, eventTable } from "../db/schema";
import { notify } from "./notify";
import { CAPYBARA_USERNAME } from "./support-ticket-embedding";

export interface EventReminderResult {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
}

interface Candidate {
  attendeeId: number;
  userId: string;
  eventId: number;
  eventTitle: string;
}

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

async function findCandidates(opts: {
  now: Date;
  eventId?: number;
  force?: boolean;
}): Promise<Candidate[]> {
  const conds = [
    eq(eventTable.status, "published"),
    eq(eventAttendeeTable.rsvp_status, "interested"),
  ];

  if (opts.eventId) {
    // Manual single-event trigger bypasses the time band.
    conds.push(eq(eventTable.id, opts.eventId));
  } else {
    const nowMs = opts.now.getTime();
    const loIso = new Date(nowMs + 25 * 60 * 1000).toISOString();
    const hiIso = new Date(nowMs + 35 * 60 * 1000).toISOString();
    conds.push(sql`${eventTable.starts_at} >= ${loIso}::timestamp`);
    conds.push(sql`${eventTable.starts_at} <= ${hiIso}::timestamp`);
  }

  if (!opts.force) conds.push(isNull(eventAttendeeTable.reminder_sent_at));

  return db
    .select({
      attendeeId: eventAttendeeTable.id,
      userId: eventAttendeeTable.user_id,
      eventId: eventTable.id,
      eventTitle: eventTable.title,
    })
    .from(eventAttendeeTable)
    .innerJoin(eventTable, eq(eventTable.id, eventAttendeeTable.event_id))
    .where(and(...conds));
}

// Claim the slot before sending so a restart or double tick never double-DMs.
async function remindOne(c: Candidate, force: boolean): Promise<boolean> {
  if (force) {
    await db
      .update(eventAttendeeTable)
      .set({ reminder_sent_at: new Date() })
      .where(eq(eventAttendeeTable.id, c.attendeeId));
  } else {
    const [claimed] = await db
      .update(eventAttendeeTable)
      .set({ reminder_sent_at: new Date() })
      .where(
        and(
          eq(eventAttendeeTable.id, c.attendeeId),
          isNull(eventAttendeeTable.reminder_sent_at),
        ),
      )
      .returning({ id: eventAttendeeTable.id });
    if (!claimed) return false;
  }

  // events.slack gates only the DM; in-app always lands so web-only users still see it.
  void notify({
    user_id: c.userId,
    type: "event_reminder",
    title: `${c.eventTitle} starts soon`,
    body: `${c.eventTitle} starts in about 30 minutes.`,
    action_url: `${publicBaseUrl()}/dashboard`,
    entity_type: "event",
    entity_id: String(c.eventId),
    slack: {
      text: `:capybara: Reminder: *${c.eventTitle}* starts in about 30 minutes.`,
      username: CAPYBARA_USERNAME,
    },
  });
  return true;
}

export async function runEventReminderSweep(opts?: {
  now?: Date;
  eventId?: number;
  force?: boolean;
}): Promise<EventReminderResult> {
  const now = opts?.now ?? new Date();
  const result: EventReminderResult = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
  };

  let candidates: Candidate[] = [];
  try {
    candidates = await findCandidates({
      now,
      eventId: opts?.eventId,
      force: opts?.force,
    });
  } catch (err) {
    console.error("[cron-event-reminder] scan failed", err);
    result.errors++;
    return result;
  }
  result.scanned = candidates.length;

  for (const c of candidates) {
    try {
      if (await remindOne(c, opts?.force ?? false)) result.sent++;
      else result.skipped++;
    } catch (err) {
      console.error("[cron-event-reminder] send failed", c.attendeeId, err);
      result.errors++;
    }
  }

  return result;
}
