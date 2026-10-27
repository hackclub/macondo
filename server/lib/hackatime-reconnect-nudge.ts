// Hackatime has no token refresh, so a revoked token is terminal until the user re-links.
// 'api_restricted' users aren't nudged: Hackatime blocks the user, so re-linking won't help.
// No-ops after Macondo ends since the DM promises streak counting; reword it before lifting that.

import { eq, sql } from "drizzle-orm";
import db from "../db";
import { auditLogTable, users } from "../db/schema";
import { checkHackatimeTokenStatus } from "./hackatime";
import { macondoHasEnded } from "./macondo-end";
import { dm } from "./slack-bot";

const NUDGE_ACTION = "hackatime_reconnect_nudged";
const RECONNECT_URL =
  "https://macondo.hackclub.com/api/auth/hackatime/login?return_to=/profile";
const PROBE_DELAY_MS = 400;

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

function nudgeText(): string {
  return (
    "Heads up: your Hackatime connection to Macondo stopped working, so your " +
    "coding hours and streak aren't being counted right now. It only takes a " +
    "few seconds to reconnect and get back on track: " +
    RECONNECT_URL +
    " :wilted_flower:"
  );
}

interface NudgeCandidate {
  id: string;
  slack_id: string;
  name: string | null;
  token: string;
}

export async function sendDueHackatimeReconnectNudges(opts?: {
  batch?: number;
  cooldownDays?: number;
  force?: boolean;
}): Promise<{
  skipped_event_over: boolean;
  scanned: number;
  probed: number;
  invalid: number;
  sent: number;
}> {
  if (macondoHasEnded() && !opts?.force) {
    return { skipped_event_over: true, scanned: 0, probed: 0, invalid: 0, sent: 0 };
  }

  const batch = opts?.batch ?? 25;
  const cooldownDays = opts?.cooldownDays ?? 7;

  // Any streak history counts, not a live streak: a broken token is what kills the streak.
  const result = await db.execute(sql`
    SELECT u.id, u.slack_id, u.name, u.hackatime_oauth_token AS token
    FROM users u
    WHERE u.hackatime_oauth_token IS NOT NULL
      AND u.hackatime_api_status = 'invalid_token'
      AND u.slack_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM projects p
        WHERE p.user_id = u.id
          AND p.hackatime_projects IS NOT NULL
          AND array_length(p.hackatime_projects, 1) >= 1
      )
      AND EXISTS (
        SELECT 1 FROM streak_days sd WHERE sd.user_id = u.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE a.actor_id = u.id
          AND a.action = ${NUDGE_ACTION}
          AND a.created_at >= NOW() - (${cooldownDays} * INTERVAL '1 day')
      )
    ORDER BY random()
    LIMIT ${batch}
  `);

  // postgres-js returns the rows array; node-postgres wraps it in .rows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: NudgeCandidate[] = Array.isArray(result)
    ? (result as unknown as NudgeCandidate[])
    : (((result as any).rows ?? []) as NudgeCandidate[]);

  let probed = 0;
  let invalid = 0;
  let sent = 0;

  for (const u of list) {
    if (!u.token || !u.slack_id) continue;
    const status = await checkHackatimeTokenStatus(u.token);
    probed += 1;
    if (status !== "invalid") {
      // Never DM on a healthy or indeterminate probe; heal a stale mark so syncs resume.
      if (status === "valid") {
        try {
          await db
            .update(users)
            .set({
              hackatime_api_status: "ok",
              hackatime_api_status_changed_at: new Date(),
            })
            .where(eq(users.id, u.id));
        } catch (err) {
          console.error(
            `[hackatime-reconnect-nudge] failed to heal stale mark for ${u.id}`,
            err,
          );
        }
      }
      await sleep(PROBE_DELAY_MS);
      continue;
    }
    invalid += 1;
    try {
      const dmResult = await dm({ user: u.slack_id, text: nudgeText() });
      if (dmResult.ok) {
        await db.insert(auditLogTable).values({
          actor_id: u.id,
          action: NUDGE_ACTION,
          entity_type: "user",
          entity_id: u.id,
          old_value: null,
          new_value: {
            reason: "hackatime_token_invalid",
            reconnect_url: RECONNECT_URL,
          },
          sensitive: false,
          public_message: `Sent Hackatime reconnect nudge to ${u.name ?? u.id}`,
          change_summary: "hackatime_reconnect_nudge",
        });
        sent += 1;
      } else {
        console.warn(
          `[hackatime-reconnect-nudge] dm failed for ${u.id}: ${dmResult.error}`,
        );
      }
    } catch (err) {
      console.error(`[hackatime-reconnect-nudge] dm error for ${u.id}`, err);
    }
    await sleep(PROBE_DELAY_MS);
  }

  return { skipped_event_over: false, scanned: list.length, probed, invalid, sent };
}
