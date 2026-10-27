import { and, eq, inArray } from "drizzle-orm";

import db from "../../../db";
import { projectGrantTable, projectTable, users } from "../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { createHcbClient } from "../../../lib/hcb";
import { canAccessInternalShopAdmin } from "../../../policies/internal";

function getErrorMessage(error: unknown, fallback: string) {
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

// Sends sequentially: HCB rate-limits and we don't want to half-send a batch.
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const body = await readBody<{ ids?: number[] }>(event);
  const ids = Array.from(
    new Set((Array.isArray(body?.ids) ? body.ids : []).filter((n) => Number.isInteger(n) && (n as number) > 0)),
  ) as number[];

  if (ids.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No grant IDs supplied" });
  }
  if (ids.length > 100) {
    throw createError({
      statusCode: 400,
      statusMessage: "At most 100 grants can be sent in one batch",
    });
  }

  const config = useRuntimeConfig();
  if (!config.hcbOrganizationId) {
    throw createError({
      statusCode: 500,
      statusMessage: "HCB organization ID not configured",
    });
  }

  const grants = await db
    .select()
    .from(projectGrantTable)
    .where(inArray(projectGrantTable.id, ids));
  const grantById = new Map(grants.map((g) => [g.id, g]));

  const projectIds = Array.from(new Set(grants.map((g) => g.project_id)));
  const userIds = Array.from(new Set(grants.map((g) => g.user_id)));

  const [projectRows, userRows] = await Promise.all([
    projectIds.length > 0
      ? db
          .select({ id: projectTable.id, name: projectTable.name })
          .from(projectTable)
          .where(inArray(projectTable.id, projectIds))
      : Promise.resolve([]),
    userIds.length > 0
      ? db
          .select({
            id: users.id,
            email: users.email,
            hcb_email: users.hcb_email,
            name: users.name,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : Promise.resolve([]),
  ]);
  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const hcbClient = createHcbClient();
  const orgId = String(config.hcbOrganizationId);
  const purpose = "Hardware Grant";

  type SendResult = {
    id: number;
    ok: boolean;
    hcb_grant_id?: string | null;
    error?: string;
  };
  const results: SendResult[] = [];

  async function auditBulkFailure(
    targetId: number,
    reason: string,
    grant: typeof grants[number] | undefined,
  ) {
    try {
      const project = grant ? projectById.get(grant.project_id) : null;
      await writeAudit({
        actor_id: actor.id,
        action: "send_project_grant_failed",
        entity_type: "project_grant",
        entity_id: String(targetId),
        old_value: grant ?? null,
        new_value: { error: reason },
        sensitive: true,
        public_message: `Bulk grant send failed: ${reason}`,
        change_summary: project?.name ?? null,
      });
    } catch (e) {
      console.error("Failed to write audit log for bulk send failure", e);
    }
  }

  for (const id of ids) {
    const grant = grantById.get(id);
    if (!grant) {
      results.push({ id, ok: false, error: "Grant not found" });
      await auditBulkFailure(id, "Grant not found", undefined);
      continue;
    }
    if (grant.status !== "queued") {
      const reason = `Grant is ${grant.status}; skipped`;
      results.push({ id, ok: false, error: reason });
      await auditBulkFailure(id, reason, grant);
      continue;
    }

    const recipient = userById.get(grant.user_id);
    const recipientEmail = recipient?.hcb_email ?? recipient?.email ?? null;
    if (!recipientEmail) {
      results.push({ id, ok: false, error: "Recipient has no email" });
      await auditBulkFailure(id, "Recipient has no email", grant);
      continue;
    }

    try {
      const response = await hcbClient.createOrganizationCardGrant(orgId, {
        amount_cents: grant.amount_cents,
        email: recipientEmail,
        purpose,
        invite_message:
          `Your Macondo hardware project was approved. Use this grant to buy the parts on your shopping cart, then come back once the build is done and submit an update ship to earn fruit for the build hours.`,
        sent_by_email: true,
        pre_authorization_required: true,
      });
      const grantResult = Array.isArray(response) ? response[0] : response;
      if (!grantResult?.id) {
        const reason = "HCB did not return a grant ID";
        results.push({ id, ok: false, error: reason });
        await auditBulkFailure(id, reason, grant);
        continue;
      }

      // Conditional update guards against a concurrent cancel between the load and the HCB call.
      const [updated] = await db
        .update(projectGrantTable)
        .set({
          status: "sent",
          hcb_grant_id: String(grantResult.id),
          hcb_response: grantResult as unknown as Record<string, unknown>,
          sent_by_user_id: actor.id,
          sent_at: new Date(),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(projectGrantTable.id, id),
            eq(projectGrantTable.status, "queued"),
          ),
        )
        .returning();
      if (!updated) {
        const reason = `HCB card ${grantResult.id} created but DB row no longer queued (concurrent cancel/send).`;
        results.push({ id, ok: false, error: reason });
        await auditBulkFailure(id, reason, grant);
        continue;
      }

      const project = projectById.get(grant.project_id);
      try {
        await writeAudit({
          actor_id: actor.id,
          action: "send_project_grant",
          entity_type: "project_grant",
          entity_id: String(id),
          old_value: grant,
          new_value: updated,
          sensitive: true,
          public_message: `HCB grant sent (bulk): $${(grant.amount_cents / 100).toFixed(2)} to ${recipientEmail}`,
          change_summary: project?.name ?? null,
        });
      } catch (e) {
        console.error("Failed to write audit log for bulk send", e);
      }

      results.push({ id, ok: true, hcb_grant_id: updated?.hcb_grant_id ?? null });
    } catch (err) {
      const reason = getErrorMessage(err, "HCB request failed");
      results.push({ id, ok: false, error: reason });
      await auditBulkFailure(id, reason, grant);
    }
  }

  const sentCount = results.filter((r) => r.ok).length;

  return {
    requested: ids.length,
    sent: sentCount,
    failed: results.length - sentCount,
    results,
  };
});
