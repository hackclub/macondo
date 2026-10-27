import { and, eq, sql } from "drizzle-orm";

import db from "../../../../db";
import {
  currencyTransactionTable,
  projectTable,
  shipTable,
} from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { notify } from "../../../../lib/notify";
import { getDevDebugFlags } from "../../../../lib/dev-debug-flags";
import {
  canReviewOwnProjects,
  canReviewShipType,
  isAbleToReview,
} from "../../../../policies/internal";

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

// retroactive version of the extra fruity checkbox in review.post.ts's approval path
export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const devDebugFlags = getDevDebugFlags(event);

  if (!actor) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  if (!isAbleToReview(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid ship ID" });
  }

  const [ship] = await db
    .select()
    .from(shipTable)
    .where(eq(shipTable.id, id))
    .limit(1);

  if (!ship) {
    throw createError({ statusCode: 404, statusMessage: "Ship not found" });
  }

  if (
    ship.user_id === actor.id &&
    !canReviewOwnProjects(actor) &&
    !devDebugFlags.ignoreReviewerOwnershipPolicies
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: "You cannot review your own project",
    });
  }

  // the flag carries a starfruit reward and badge, so only approved ships qualify
  if (ship.status !== "shipped" && ship.status !== "shipped_missing_airtable") {
    throw createError({
      statusCode: 400,
      statusMessage: `Ship is ${ship.status}; only approved ships can be marked extra fruity.`,
    });
  }

  if (ship.extra_fruity === true) {
    throw createError({
      statusCode: 400,
      statusMessage: "This ship is already marked extra fruity.",
    });
  }

  const [project] = await db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      type: projectTable.type,
    })
    .from(projectTable)
    .where(eq(projectTable.id, ship.project_id))
    .limit(1);

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  if (!canReviewShipType(actor, project.type)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Your reviewer role does not cover ${project.type} ships.`,
    });
  }

  const now = new Date();

  // conditional update so a concurrent click gets 409 instead of a duplicate starfruit
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(shipTable)
      .set({ extra_fruity: true })
      .where(
        and(
          eq(shipTable.id, id),
          sql`${shipTable.extra_fruity} IS DISTINCT FROM true`,
        ),
      )
      .returning();

    if (!row) {
      throw createError({
        statusCode: 409,
        statusMessage: "Ship was already marked extra fruity by another reviewer.",
      });
    }

    await tx.insert(currencyTransactionTable).values({
      user_id: ship.user_id,
      amount: 1,
      type: "increase",
      source: "extra_fruity_reward",
      ship_id: ship.id,
      fruit_type: "starfruit",
      memo: `Extra fruity ship #${ship.id} (post-review): +1 starfruit`,
      counts: true,
      unlocked_at: now,
    });

    return row;
  });

  try {
    await writeAudit({
      actor_id: actor.id,
      action: "ship.extra_fruity.mark_post_review",
      entity_type: "ship",
      entity_id: String(ship.id),
      old_value: { extra_fruity: false },
      new_value: { extra_fruity: true, starfruit_awarded: 1 },
      sensitive: false,
      public_message: "Marked ship as extra fruity after review",
      change_summary: project.name,
    });
  } catch (e) {
    console.error("Failed to write audit log for ship.extra_fruity.mark_post_review", e);
  }

  // fire-and-forget, mirroring reverse-decision.post.ts
  void notify({
    user_id: ship.user_id,
    type: "ship_extra_fruity",
    title: `Your ship for ${project.name} is extra fruity`,
    body: "A reviewer marked this specific ship as extra fruity for an exceptional build. You earned 1 starfruit, and this ship now carries the Extra Fruity badge.",
    action_url: `${publicBaseUrl()}/projects/${project.id}`,
    entity_type: "ship",
    entity_id: String(ship.id),
    slack: {
      text: `:tada: Your ship for *${project.name}* (ship #${ship.id}) was marked extra fruity! +1 starfruit.`,
    },
  });

  return {
    ok: true,
    ship_id: ship.id,
    ship: updated,
  };
});
