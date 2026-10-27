// Reuses the single-gift helpers per attendee so ledger, notification and audit logic live in one place.

import { inArray } from "drizzle-orm";

import db from "~~/server/db";
import { eventAttendeeTable } from "~~/server/db/schema";
import { writeAudit } from "~~/server/lib/audit";
import { approveEventGift, denyEventGift } from "~~/server/lib/events";
import { canDecideEventGifts } from "~~/server/policies/internal";

type Body = {
  attendee_ids?: number[];
  decision?: "approve" | "deny";
  reason?: string;
};

type DecideResult = {
  id: number;
  ok: boolean;
  kind?: "gold" | "shop_item";
  transactionId?: number;
  orderId?: number;
  error?: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error &&
    "statusMessage" in error &&
    typeof (error as { statusMessage?: string }).statusMessage === "string"
  ) {
    return (error as { statusMessage: string }).statusMessage;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canDecideEventGifts(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<Body>(event).catch(() => ({}) as Body);

  const decision = body.decision;
  if (decision !== "approve" && decision !== "deny") {
    throw createError({
      statusCode: 400,
      statusMessage: "decision must be 'approve' or 'deny'",
    });
  }
  const reason = decision === "deny" ? body.reason : undefined;

  const ids = Array.from(
    new Set((Array.isArray(body.attendee_ids) ? body.attendee_ids : []).filter((n) => Number.isInteger(n) && (n as number) > 0)),
  ) as number[];

  if (ids.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "No attendee IDs supplied",
    });
  }
  if (ids.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: "At most 100 gifts can be decided in one batch",
    });
  }

  // Preload existing ids so a missing one gets "Attendee not found" instead of the helper's misleading 409.
  const rows = await db
    .select({ id: eventAttendeeTable.id })
    .from(eventAttendeeTable)
    .where(inArray(eventAttendeeTable.id, ids));
  const existingIds = new Set(rows.map((r) => r.id));

  // Audit every rejected row, even no-op ones, so the trail stays complete.
  async function auditBulkFailure(targetId: number, message: string) {
    try {
      await writeAudit({
        actor_id: actor.id,
        action: "event_gift_decide_failed",
        entity_type: "event_attendee",
        entity_id: String(targetId),
        new_value: { decision, error: message },
        sensitive: false,
        public_message: `Bulk event gift ${decision} failed: ${message}`,
      });
    } catch (e) {
      console.error("Failed to write audit log for bulk decide failure", e);
    }
  }

  const results: DecideResult[] = [];

  for (const id of ids) {
    if (!existingIds.has(id)) {
      results.push({ id, ok: false, error: "Attendee not found" });
      await auditBulkFailure(id, "Attendee not found");
      continue;
    }

    try {
      if (decision === "approve") {
        const r = await approveEventGift({ attendeeId: id, actorId: actor.id });
        results.push({
          id,
          ok: true,
          kind: r.kind,
          ...(r.kind === "gold"
            ? { transactionId: r.transactionId }
            : { orderId: r.orderId }),
        });
      } else {
        await denyEventGift({ attendeeId: id, actorId: actor.id, reason });
        results.push({ id, ok: true });
      }
    } catch (err) {
      const message = getErrorMessage(err, "Failed to decide gift");
      results.push({ id, ok: false, error: message });
      await auditBulkFailure(id, message);
    }
  }

  const decided = results.filter((r) => r.ok).length;
  return {
    requested: ids.length,
    decided,
    failed: results.length - decided,
    results,
  };
});
