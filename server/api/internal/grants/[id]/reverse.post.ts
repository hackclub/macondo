import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";

import db from "../../../../db";
import {
  auditLogTable,
  currencyTransactionTable,
  projectGrantTable,
  users,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid grant ID" });
  }

  const reason = (await readBody<{ reason?: string | null }>(event))?.reason?.trim() || null;
  if (!reason) {
    throw createError({
      statusCode: 400,
      statusMessage: "A reverse reason is required",
    });
  }

  const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
  const operation = await db.transaction(async (tx) => {
    const [grant] = await tx
      .select()
      .from(projectGrantTable)
      .where(eq(projectGrantTable.id, id))
      .for("update")
      .limit(1);

    if (!grant) {
      throw createError({ statusCode: 404, statusMessage: "Grant not found" });
    }
    if (grant.status !== "cancelled") {
      throw createError({
        statusCode: 409,
        statusMessage: `Grant is ${grant.status}; only cancelled grants can be reversed.`,
      });
    }
    if (
      grant.cancelled_at
      && Date.now() - grant.cancelled_at.getTime() > UNDO_WINDOW_MS
    ) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "Undo cancel is only available within 24 hours of the cancel. Use Reissue to create a fresh grant instead.",
      });
    }

    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${grant.user_id})::bigint)`,
    );

    if (grant.cancel_fruit_tx_id != null) {
      const [reward] = await tx
        .select({
          amount: currencyTransactionTable.amount,
          counts: currencyTransactionTable.counts,
          user_id: currencyTransactionTable.user_id,
        })
        .from(currencyTransactionTable)
        .where(eq(currencyTransactionTable.id, grant.cancel_fruit_tx_id))
        .for("update")
        .limit(1);

      if (reward?.counts) {
        const [balanceRow] = await tx
          .select({
            total: sql<number>`
              COALESCE(SUM(
                CASE
                  WHEN ${currencyTransactionTable.type} = 'increase'
                    THEN ${currencyTransactionTable.amount}
                  ELSE -${currencyTransactionTable.amount}
                END
              ), 0)
            `.mapWith(Number),
          })
          .from(currencyTransactionTable)
          .where(
            and(
              eq(currencyTransactionTable.user_id, reward.user_id),
              eq(currencyTransactionTable.counts, true),
              isNull(currencyTransactionTable.fruit_type),
              isNotNull(currencyTransactionTable.unlocked_at),
              eq(currencyTransactionTable.priority, false),
            ),
          );
        if (Number(balanceRow?.total ?? 0) < Number(reward.amount)) {
          throw createError({
            statusCode: 409,
            statusMessage:
              "User has already spent the fallback gold; cannot reverse.",
          });
        }
      }
    }

    const [conflict] = await tx
      .select({ id: projectGrantTable.id })
      .from(projectGrantTable)
      .where(
        and(
          eq(projectGrantTable.ship_id, grant.ship_id),
          inArray(projectGrantTable.status, ["queued", "sent"]),
        ),
      )
      .limit(1);
    if (conflict) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "Another active grant exists for this ship (a reissue may already be in flight). Cancel the reissue before reversing.",
      });
    }

    const [streakRepair] = await tx
      .select({ new_value: auditLogTable.new_value })
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.entity_type, "project_grant"),
          eq(auditLogTable.entity_id, String(id)),
          eq(auditLogTable.action, "cross_project_grant_fallback_repaired"),
        ),
      )
      .orderBy(desc(auditLogTable.created_at), desc(auditLogTable.id))
      .limit(1);
    const repairedValue = streakRepair?.new_value as Record<string, unknown> | null;
    const repairedLifetimeFruit =
      typeof repairedValue?.lifetime_fruit === "string"
        ? repairedValue.lifetime_fruit
        : null;
    const repairedLifetimeDelta = Number(
      repairedValue?.lifetime_fruit_delta ?? 0,
    );

    if (grant.cancel_fruit_tx_id != null) {
      await tx
        .update(currencyTransactionTable)
        .set({ counts: false })
        .where(
          and(
            eq(currencyTransactionTable.id, grant.cancel_fruit_tx_id),
            eq(currencyTransactionTable.counts, true),
          ),
        );
    }

    if (
      repairedLifetimeFruit
      && Number.isFinite(repairedLifetimeDelta)
      && repairedLifetimeDelta > 0
    ) {
      await tx
        .update(users)
        .set({
          lifetime_fruits_earned: sql`
            jsonb_set(
              COALESCE(${users.lifetime_fruits_earned}, '{}'::jsonb),
              ARRAY[${repairedLifetimeFruit}]::text[],
              to_jsonb(GREATEST(
                0,
                COALESCE((${users.lifetime_fruits_earned} ->> ${repairedLifetimeFruit})::numeric, 0)
                  - ${repairedLifetimeDelta}::numeric
              )),
              true
            )
          `,
        })
        .where(eq(users.id, grant.user_id));
    }

    const [updated] = await tx
      .update(projectGrantTable)
      .set({
        status: "queued",
        cancelled_by_user_id: null,
        cancelled_at: null,
        cancel_reason: null,
        cancel_fruit_tx_id: null,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(projectGrantTable.id, id),
          eq(projectGrantTable.status, "cancelled"),
        ),
      )
      .returning();

    if (!updated) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to reverse grant",
      });
    }

    return {
      grant,
      updated,
      repairedLifetimeFruit,
      repairedLifetimeDelta,
    };
  });

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "reverse_project_grant",
      entity_type: "project_grant",
      entity_id: String(id),
      old_value: operation.grant,
      new_value: {
        ...operation.updated,
        lifetime_fruit_decrement:
          operation.repairedLifetimeFruit
          && operation.repairedLifetimeDelta > 0
            ? {
                fruit: operation.repairedLifetimeFruit,
                amount: operation.repairedLifetimeDelta,
              }
            : null,
      },
      sensitive: true,
      public_message: `Grant reversed (back to queued): ${reason}`,
    });
  } catch (e) {
    console.error("Failed to write audit log for reverse_project_grant", e);
  }

  return operation.updated;
});
