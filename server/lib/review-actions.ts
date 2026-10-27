
import { eq, sql } from "drizzle-orm";
import db from "../db";
import { projectTable, shipTable } from "../db/schema";
import type { InferSelectModel } from "drizzle-orm";
import { writeAudit } from "./audit";
import { notify } from "./notify";
import { buildRejectionUserMessage } from "./rejection-message";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

type Ship = InferSelectModel<typeof shipTable>;

// Reviewers are not paid gold for decisions; old review_reward rows still count.

export type MarkShipRejectedArgs = {
  shipId: number;
  shipBefore: Ship;
  projectId: number;
  projectName: string;
  notifyUserId: string;
  actorId: string;
  auditNotes: string | null | undefined;
  userMessage: string | null | undefined;
  decisionAttachments: unknown;
  // e.g. " by reviewer-name".
  slackAttribution: string;
  // Only "reviewer" writes 'reject_ship', which the leaderboard counts.
  source: "reviewer" | "ari";
};

export type MarkShipRejectedResult =
  | { ok: true; ship: Ship }
  | { ok: false; reason: "wrong_status" | "not_found" };

// wrong_status means another path raced ahead.
export async function markShipRejected(
  args: MarkShipRejectedArgs,
): Promise<MarkShipRejectedResult> {
  const auditNotes = args.auditNotes?.trim() || null;
  // Also persisted, so the timeline never shows an empty decision_user_message.
  const userBody = buildRejectionUserMessage({
    reviewerMessage: args.userMessage ?? null,
    fraudJustification: null,
    trustScore: null,
  });

  const [updatedShip] = await db
    .update(shipTable)
    .set({
      status: "rejected",
      reviewed_at: new Date(),
      decision_audit_notes: auditNotes,
      decision_user_message: userBody,
      decision_user_message_attachments: args.decisionAttachments as never,
    })
    .where(
      sql`${shipTable.id} = ${args.shipId} AND ${shipTable.status} IN ('under_review', 'pending_fraud_review', 'pending_second_pass')`,
    )
    .returning();

  if (!updatedShip) {
    const [stillExists] = await db
      .select({ id: shipTable.id })
      .from(shipTable)
      .where(sql`${shipTable.id} = ${args.shipId}`)
      .limit(1);
    return { ok: false, reason: stillExists ? "wrong_status" : "not_found" };
  }

  // So a re-ship doesn't inherit the rejected ship's drafts. Kept in sync with
  // finalize-ship-approval.ts.
  await db
    .update(projectTable)
    .set({
      next_ship_is_update: false,
      next_ship_update_description: null,
      next_ship_used_ai: false,
      next_ship_ai_usage_description: null,
      next_ship_needs_funding: false,
      next_ship_is_build_complete: false,
      next_ship_reviewer_note: null,
      updated_at: new Date(),
    })
    .where(eq(projectTable.id, args.projectId));

  const auditAction =
    args.source === "ari"
      ? "reject_ship_ari"
      : "reject_ship";
  try {
    await writeAudit({
      actor_id: args.actorId,
      action: auditAction,
      entity_type: "ship",
      entity_id: String(args.shipId),
      old_value: args.shipBefore,
      new_value: updatedShip,
      sensitive: false,
      public_message: "Ship rejected",
      change_summary:
        args.source === "ari"
          ? `${args.projectName} (via ARI)`
          : args.projectName,
    });
  } catch (error) {
    console.error("[review-actions] audit write failed for reject", error);
  }

  const projectUrl = `${publicBaseUrl()}/projects/${args.projectId}`;
  void notify({
    user_id: args.notifyUserId,
    type: "ship_rejected",
    title: `Your ship for ${args.projectName} was rejected`,
    body: userBody,
    action_url: projectUrl,
    entity_type: "ship",
    entity_id: String(args.shipId),
    slack: {
      text: `:x: Your ship for *${args.projectName}* was rejected${args.slackAttribution}.\n>${userBody}`,
    },
    email: {
      template: "ship_rejected",
      data: {
        project_name: args.projectName,
        feedback: userBody,
        project_url: projectUrl,
      },
    },
  });

  return { ok: true, ship: updatedShip };
}
