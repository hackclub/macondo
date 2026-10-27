import { and, desc, eq, ne, sql } from "drizzle-orm";

import db from "../../../../db";
import { projectGrantTable, projectTable, users } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { createHcbClient, hcbCardGrantWebUrl, type HcbCardGrant } from "../../../../lib/hcb";
import { notify } from "../../../../lib/notify";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

type SendAction = "first_card" | "top_up" | "reissue";

function getErrorMessage(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error &&
    "statusMessage" in error &&
    typeof error.statusMessage === "string"
  ) {
    return error.statusMessage;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

// Ignores HCB card state; the caller asks HCB whether it's active to pick top_up vs reissue.
async function getMostRecentPriorSent(
  projectId: number,
  excludeGrantId: number,
) {
  const [row] = await db
    .select()
    .from(projectGrantTable)
    .where(
      and(
        eq(projectGrantTable.project_id, projectId),
        eq(projectGrantTable.status, "sent"),
        ne(projectGrantTable.id, excludeGrantId),
      ),
    )
    .orderBy(
      sql`${projectGrantTable.sent_at} DESC NULLS LAST`,
      desc(projectGrantTable.id),
    )
    .limit(1);
  return row ?? null;
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid grant ID" });
  }

  const config = useRuntimeConfig();
  if (!config.hcbOrganizationId) {
    throw createError({
      statusCode: 500,
      statusMessage: "HCB organization ID not configured",
    });
  }

  const [grant] = await db
    .select()
    .from(projectGrantTable)
    .where(eq(projectGrantTable.id, id))
    .limit(1);

  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: "Grant not found" });
  }
  if (grant.status !== "queued") {
    throw createError({
      statusCode: 409,
      statusMessage: `Grant is not queued (currently ${grant.status}).`,
    });
  }

  const [recipient] = await db
    .select({
      id: users.id,
      email: users.email,
      hcb_email: users.hcb_email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, grant.user_id))
    .limit(1);

  if (!recipient) {
    throw createError({ statusCode: 404, statusMessage: "Recipient not found" });
  }

  const recipientEmail = recipient.hcb_email ?? recipient.email ?? null;
  if (!recipientEmail) {
    throw createError({
      statusCode: 400,
      statusMessage: "Recipient has no email available for HCB grant delivery",
    });
  }

  const [project] = await db
    .select({ name: projectTable.name })
    .from(projectTable)
    .where(eq(projectTable.id, grant.project_id))
    .limit(1);

  // intended_send_action from approval may be stale (card cancelled since), so decide from live HCB state.
  const priorSent = await getMostRecentPriorSent(grant.project_id, grant.id);
  let priorCard: HcbCardGrant | null = null;
  if (priorSent?.hcb_grant_id) {
    try {
      priorCard = await createHcbClient().getCardGrant(priorSent.hcb_grant_id);
    } catch (e) {
      console.error(
        "[grants.send] Failed to fetch prior HCB card; falling back to first_card path",
        e,
      );
      priorCard = null;
    }
  }

  const effectiveAction: SendAction = priorCard?.status === "active"
    ? "top_up"
    : priorSent
      ? "reissue"
      : "first_card";

  // HCB caps card_grant purpose at 30 chars, so use a generic label rather than the project name.
  const purpose = "Hardware Grant";
  const projectName = project?.name ?? `project #${grant.project_id}`;

  let hcbResponse: HcbCardGrant;
  let hcbCardIdForRow: string;
  let cardReplacesId: string | null = null;

  try {
    const hcbClient = createHcbClient();

    if (effectiveAction === "top_up") {
      // Top up the active card so grants on one project share one balance.
      hcbResponse = await hcbClient.topUpCardGrant(
        priorCard!.id,
        grant.amount_cents,
      );
      hcbCardIdForRow = priorCard!.id;
    } else {
      cardReplacesId = effectiveAction === "reissue" && priorSent
        ? priorSent.hcb_grant_id
        : null;

      const inviteMessage = cardReplacesId
        ? `Your previous Macondo grant card was cancelled. We've issued a new card with your latest approved grant. Use it to buy the parts on your shopping cart, then come back once the build is done and submit an update ship to earn fruit for the build hours.`
        : `Your Macondo hardware project was approved. Use this grant to buy the parts on your shopping cart, then come back once the build is done and submit an update ship to earn fruit for the build hours.`;

      const created = await hcbClient.createOrganizationCardGrant(
        String(config.hcbOrganizationId),
        {
          amount_cents: grant.amount_cents,
          email: recipientEmail,
          purpose,
          invite_message: inviteMessage,
          sent_by_email: true,
          pre_authorization_required: true,
        },
      );
      const grantResult = Array.isArray(created) ? created[0] : created;
      if (!grantResult?.id) {
        throw createError({
          statusCode: 502,
          statusMessage: "HCB did not return a card grant ID",
        });
      }
      hcbResponse = grantResult;
      hcbCardIdForRow = grantResult.id;
    }

    // Refuse to mark sent if pre-auth got disabled; top-ups keep card settings, so this catches drift too.
    if ((await hcbClient.getCardGrant(hcbCardIdForRow)).pre_authorization_required === false) {
      try {
        await writeAudit({
          actor_id: actor.id,
          action: "send_project_grant_preauth_drift",
          entity_type: "project_grant",
          entity_id: String(id),
          old_value: grant,
          new_value: {
            hcb_grant_id: hcbCardIdForRow,
            effective_action: effectiveAction,
            message:
              "HCB returned pre_authorization_required=false. Refusing to mark grant sent until reconciled.",
          },
          sensitive: true,
          public_message: `Pre-auth drift on HCB card ${hcbCardIdForRow} for grant #${id}`,
        });
      } catch (e) {
        console.error(
          "Failed to write audit for send_project_grant_preauth_drift",
          e,
        );
      }
      throw createError({
        statusCode: 502,
        statusMessage: `HCB card ${hcbCardIdForRow} has pre_authorization_required=false. Reconcile manually before retrying.`,
      });
    }

    // Conditional update guards against a concurrent cancel/send between the load and the HCB call.
    const intentDrift = grant.intended_send_action !== effectiveAction;
    const [updatedGrant] = await db
      .update(projectGrantTable)
      .set({
        status: "sent",
        hcb_grant_id: hcbCardIdForRow,
        hcb_response: hcbResponse as unknown as Record<string, unknown>,
        hcb_card_replaces_id: cardReplacesId,
        intended_send_action: effectiveAction,
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
    if (!updatedGrant) {
      // HCB already committed, so audit the drift and fail loud for manual repair.
      try {
        await writeAudit({
          actor_id: actor.id,
          action: "send_project_grant_drift",
          entity_type: "project_grant",
          entity_id: String(id),
          old_value: grant,
          new_value: {
            hcb_grant_id: hcbCardIdForRow,
            effective_action: effectiveAction,
            message:
              "HCB committed the card grant action but our DB row was no longer queued (concurrent cancel/send).",
          },
          sensitive: true,
          public_message: `Grant #${id} drift: HCB ${effectiveAction} on card ${hcbCardIdForRow} but row was no longer queued.`,
        });
      } catch (e) {
        console.error("Failed to audit send_project_grant_drift", e);
      }
      throw createError({
        statusCode: 409,
        statusMessage:
          `Grant is no longer queued, but HCB already committed action (${effectiveAction}) on card ${hcbCardIdForRow}. Reconcile manually.`,
      });
    }

    try {
      await writeAudit({
        actor_id: actor.id,
        action: "send_project_grant",
        entity_type: "project_grant",
        entity_id: String(id),
        old_value: grant,
        new_value: updatedGrant,
        sensitive: true,
        public_message: `HCB grant ${effectiveAction === "top_up" ? "topped up" : effectiveAction === "reissue" ? "reissued" : "sent"}: $${(grant.amount_cents / 100).toFixed(2)} to ${recipientEmail}${cardReplacesId ? ` (replaces ${cardReplacesId})` : ""}${intentDrift ? ` [intent drift: was ${grant.intended_send_action}, sent as ${effectiveAction}]` : ""}`,
        change_summary: project?.name ?? null,
      });
    } catch (e) {
      console.error("Failed to write audit log for send_project_grant", e);
    }

    const amountUsd = (grant.amount_cents / 100).toFixed(2);
    const hcbGrantUrl = hcbCardGrantWebUrl(hcbCardIdForRow);

    const notifyTitle = effectiveAction === "top_up"
      ? `$${amountUsd} added to your Macondo grant card for ${projectName}`
      : effectiveAction === "reissue"
        ? `$${amountUsd} grant on a new card for ${projectName}`
        : `$${amountUsd} grant sent for ${projectName}`;

    const notifyBody = effectiveAction === "top_up"
      ? `Your existing Macondo grant card was topped up by $${amountUsd}. Open it to use the new balance.`
      : effectiveAction === "reissue"
        ? `Your previous card was cancelled. We've issued a new one. Check your email (${recipientEmail}) for the HCB invite.`
        : `Your hardware grant has been sent. Check your email (${recipientEmail}) for the HCB invite, or open the grant directly.`;

    const slackText = effectiveAction === "top_up"
      ? `:money_with_wings: Topped up Macondo card by $${amountUsd} for *${projectName}* by ${actor.username ?? "an admin"}${actor.slack_id ? ` (<@${actor.slack_id}>)` : ""}.`
      : effectiveAction === "reissue"
        ? `:money_with_wings: Reissued Macondo card with $${amountUsd} for *${projectName}* by ${actor.username ?? "an admin"}${actor.slack_id ? ` (<@${actor.slack_id}>)` : ""} (replaces cancelled card ${cardReplacesId}).`
        : `:money_with_wings: $${amountUsd} grant sent for *${projectName}* by ${actor.username ?? "an admin"}${actor.slack_id ? ` (<@${actor.slack_id}>)` : ""}. Watch your inbox (${recipientEmail}) for the HCB invite.`;

    void notify({
      user_id: grant.user_id,
      type: "hardware_grant_sent",
      title: notifyTitle,
      body: notifyBody,
      action_url: hcbGrantUrl,
      entity_type: "project_grant",
      entity_id: String(id),
      slack: { text: slackText },
      email: {
        template: "hardware_grant_sent",
        data: {
          project_name: projectName,
          amount_usd: `$${amountUsd} USD`,
          hcb_grant_url: hcbGrantUrl,
        },
      },
    });

    return updatedGrant;
  } catch (error) {
    const message = getErrorMessage(error, "HCB grant creation failed");
    // Leave the grant queued so the admin can retry.
    try {
      await writeAudit({
        actor_id: actor.id,
        action: "send_project_grant_failed",
        entity_type: "project_grant",
        entity_id: String(id),
        old_value: grant,
        new_value: { error: message, effective_action: effectiveAction },
        sensitive: true,
        public_message: `HCB grant send failed (${effectiveAction}): ${message}`,
        change_summary: project?.name ?? null,
      });
    } catch (e) {
      console.error("Failed to write audit log for send_project_grant_failed", e);
    }
    throw createError({ statusCode: 502, statusMessage: message });
  }
});
