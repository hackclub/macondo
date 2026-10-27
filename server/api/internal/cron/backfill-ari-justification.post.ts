// re-renders ARI justifications on Unified rows synced before the payload reached the sync;
// justificationOnly patches just that field so other admin edits survive

import { and, inArray, isNotNull, sql } from "drizzle-orm";

import db from "../../../db";
import { shipTable, type users } from "../../../db/schema";
import { syncShipToAirtable } from "../../../lib/airtable";
import { isValidCronToken } from "../../../lib/cron-token";
import { hasRole } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  // Timing-safe comparison; a missing secret or header fails closed.
  const cronAllowed = isValidCronToken(event);
  const userAllowed = actor != null && hasRole(actor, ["supaadmin", "admin"]);
  if (!cronAllowed && !userAllowed) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{ shipIds?: number[]; dryRun?: boolean } | null>(
    event,
  ).catch(() => null);
  const dryRun = body?.dryRun === true;
  const rawShipIds = body?.shipIds;
  const explicitIds = Array.isArray(rawShipIds)
    ? rawShipIds.filter((n) => Number.isInteger(n) && n > 0)
    : null;
  if (explicitIds && explicitIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "shipIds is empty" });
  }

  const candidates = await db
    .select({ id: shipTable.id })
    .from(shipTable)
    .where(
      and(
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        isNotNull(shipTable.airtable_record_id),
        sql`${shipTable.ari_last_event} -> 'review' -> 'justification' IS NOT NULL`,
        ...(explicitIds ? [inArray(shipTable.id, explicitIds)] : []),
      ),
    )
    .orderBy(shipTable.id);

  if (dryRun) {
    return {
      dryRun: true,
      count: candidates.length,
      shipIds: candidates.map((c) => c.id),
    };
  }

  // sequential on purpose: airtable is rate-limited to 5 rps per base
  const results: Array<{
    shipId: number;
    ok: boolean;
    reason?: string;
    recordIds: string[];
  }> = [];
  for (const { id } of candidates) {
    const r = await syncShipToAirtable(id, {
      force: true,
      justificationOnly: true,
    });
    results.push({
      shipId: id,
      ok: r.ok,
      ...(r.ok ? {} : { reason: r.reason }),
      recordIds: r.recordIds,
    });
  }

  return {
    dryRun: false,
    count: results.length,
    okCount: results.filter((r) => r.ok).length,
    results,
  };
});
