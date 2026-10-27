import { resolveViewerLang } from "../../../lib/viewer-language";
import { desc, eq, sql } from "drizzle-orm";

import db from "../../../db";
import { currencyTransactionTable, projectGrantTable, shipTable } from "../../../db/schema";
import { cached, projectCacheKeys } from "../../../lib/cache";
import { getProjectById } from "../../../lib/projects";
import { getSession } from "../../../lib/session";
import { isActiveCollaborator } from "../../../policies/projects";
import { isFraudSquadRejectionMessage } from "../../../lib/rejection-message";
import { translateShipFeedback } from "../../../lib/translate-feedback";

function getPublicShipStatus(status: string) {
  // Hide the fraud step from students. Second pass stays visible so accepted ships don't get withdrawn.
  return status === "pending_fraud_review" ? "under_review" : status;
}

export default defineEventHandler(async (event) => {
  const user = await getSession(event);

  const id = Number(getRouterParam(event, "id"));
  if (!id || Number.isNaN(id)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid project ID" });
  }

  const project = await getProjectById(id);
  if (!project) {
    throw createError({ statusCode: 404, statusMessage: "Project not found" });
  }

  // Collaborators are trusted teammates, so they see the full shape like the owner.
  const canViewOwnerDetails =
    !!user &&
    (user.id === project.user_id || (await isActiveCollaborator(user.id, id)));

  const ships = await cached(projectCacheKeys(id).ships, 60, async () => { // cache ttl in seconds
    const rows = await db
      .select({
        id: shipTable.id,
        status: shipTable.status,
        hackatime_hours: shipTable.hackatime_hours,
        override_hours: shipTable.override_hours,
        needs_funding: shipTable.needs_funding,
        needs_funding_amount_cents: shipTable.needs_funding_amount_cents,
        used_ai: shipTable.used_ai,
        ai_usage_description: shipTable.ai_usage_description,
        decision_user_message: shipTable.decision_user_message,
        decision_user_message_translations: shipTable.decision_user_message_translations,
        decision_user_message_attachments: shipTable.decision_user_message_attachments,
        created_at: shipTable.created_at,
        reviewed_at: shipTable.reviewed_at,
        // Net gold: ship_reward plus signed manual_adjustment corrections, floored at 0.
        // sql.raw('ships.id') because ${shipTable.id} binds to the inner table's id in these subqueries.
        fruitRewarded: sql<number>`GREATEST(COALESCE((
          SELECT SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase'
            THEN ${currencyTransactionTable.amount}
            ELSE -${currencyTransactionTable.amount}
          END)
          FROM ${currencyTransactionTable}
          WHERE ${currencyTransactionTable.ship_id} = ${sql.raw('ships.id')}
            AND ${currencyTransactionTable.source} IN ('ship_reward', 'manual_adjustment')
            AND ${currencyTransactionTable.fruit_type} IS NULL
            AND ${currencyTransactionTable.counts} = true
        ), 0), 0)`.mapWith(Number),
        // Cancelled grants excluded so the history shows the current payout.
        grantAmountCents: sql<number | null>`(
          SELECT ${projectGrantTable.amount_cents}
          FROM ${projectGrantTable}
          WHERE ${projectGrantTable.ship_id} = ${sql.raw('ships.id')}
            AND ${projectGrantTable.status} IN ('queued','sent')
          ORDER BY ${projectGrantTable.created_at} DESC
          LIMIT 1
        )`.mapWith((v) => (v == null ? null : Number(v))),
        grantStatus: sql<string | null>`(
          SELECT ${projectGrantTable.status}::text
          FROM ${projectGrantTable}
          WHERE ${projectGrantTable.ship_id} = ${sql.raw('ships.id')}
            AND ${projectGrantTable.status} IN ('queued','sent')
          ORDER BY ${projectGrantTable.created_at} DESC
          LIMIT 1
        )`,
      })
      .from(shipTable)
      .where(eq(shipTable.project_id, id))
      .orderBy(desc(shipTable.created_at));

    return rows.map((ship) => ({
      ...ship,
      // Keyed off the canned fraud-squad message, not fraud_project_id, so human reviewers' messages
      // show verbatim; a boolean so non-owners can't see the upstream UUID.
      is_fraud_rejection:
        ship.status === "rejected" &&
        isFraudSquadRejectionMessage(ship.decision_user_message),
      status: getPublicShipStatus(ship.status),
    }));
  });

  // Non-members never see grant amounts or AI usage.
  const visibleShips = canViewOwnerDetails
    ? ships
    : ships.map((ship) => ({
        id: ship.id,
        status: ship.status,
        hackatime_hours: ship.hackatime_hours,
        override_hours: ship.override_hours,
        created_at: ship.created_at,
        reviewed_at: ship.reviewed_at,
        fruitRewarded: ship.fruitRewarded,
        decision_user_message: null,
        decision_user_message_translations: null,
        decision_user_message_attachments: [],
        is_fraud_rejection: false,
      }));

  const cookieLang = getCookie(event, "i18n_locale");
  const viewerLang = resolveViewerLang((typeof getQuery(event).lang === "string" ? (getQuery(event).lang as string) : null) || cookieLang || user?.locale || "en");

  if (viewerLang === "en") {
    return visibleShips.map(({ decision_user_message_translations: _ignored, ...rest }) => rest);
  }

  return Promise.all(
    visibleShips.map(async (ship) => {
      const { decision_user_message_translations: messageTranslations, ...rest } = ship;
      if (!ship.decision_user_message) return rest;
      const edited = messageTranslations?.[viewerLang];
      const translated = edited
        ? edited
        : await translateShipFeedback(ship.id, viewerLang, ship.decision_user_message);
      return {
        ...rest,
        decision_user_message: translated,
        decision_user_message_original: ship.decision_user_message,
        decision_user_message_is_translated: translated !== ship.decision_user_message,
        decision_user_message_is_edited: !!edited,
      };
    }),
  );
});
