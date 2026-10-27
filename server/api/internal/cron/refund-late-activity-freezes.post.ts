import { and, gte, isNotNull } from "drizzle-orm";
import db from "../../../db";
import { users } from "../../../db/schema";
import { refundFrozenDaysWithLateActivity } from "../../../lib/streaks";
import { hasRole } from "../../../policies/internal";

// userId and dryRun let this double as a backfill for the hackatime-lag race and a spot-check
export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{
    userId?: string;
    dryRun?: boolean;
    windowDays?: number;
  }>(event).catch(() => null);
  const dryRun = body?.dryRun ?? false;
  const windowDays = body?.windowDays;

  if (body?.userId) {
    return {
      dry_run: dryRun,
      scanned: 1,
      ...(await refundFrozenDaysWithLateActivity(body.userId, {
        actorId: actor.id,
        dryRun,
        windowDays,
      })),
    };
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const targets = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(isNotNull(users.last_active_date), gte(users.last_active_date, since)),
    );

  let refunded = 0;
  let flipped = 0;
  let wouldRefund = 0;
  const perUser: Array<{
    user_id: string;
    refunded: string[];
    flipped: string[];
    would_refund: string[];
  }> = [];
  for (const t of targets) {
    try {
      const r = await refundFrozenDaysWithLateActivity(t.id, {
        actorId: actor.id,
        dryRun,
        windowDays,
      });
      refunded += r.refunded.length;
      flipped += r.flipped.length;
      wouldRefund += r.wouldRefund.length;
      if (r.refunded.length || r.flipped.length || r.wouldRefund.length) {
        perUser.push({
          user_id: t.id,
          refunded: r.refunded,
          flipped: r.flipped,
          would_refund: r.wouldRefund,
        });
      }
    } catch (err) {
      console.error(
        `[cron/refund-late-activity-freezes] failed for ${t.id}`,
        err,
      );
    }
  }

  return {
    dry_run: dryRun,
    scanned: targets.length,
    refunded,
    flipped,
    would_refund: wouldRefund,
    users: perUser,
  };
});
