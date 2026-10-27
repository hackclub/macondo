import { and, eq, isNull, sql } from "drizzle-orm";

import db from "../../db";
import { currencyTransactionTable, shopItemTable } from "../../db/schema";
import { EVENT_INVITE_SLUG, formatShopItemForResponse } from "../../lib/shop";
import { getCertificateEligibility } from "../../lib/certificates";
import { EVENT_QUALIFY_HOURS } from "../../lib/event-auto-qualify";
import { getSession } from "../../lib/session";
import { userHasShippedProject } from "../../lib/ships";

// Logged-out viewers get a safe shape with no per-user queries. Never cached:
// the per-user fields must always be live.
export default defineEventHandler(async (event) => {
  const user = await getSession(event);

  const [itemRow] = await db
    .select()
    .from(shopItemTable)
    .where(eq(shopItemTable.slug, EVENT_INVITE_SLUG))
    .limit(1);

  const item = itemRow
    ? (() => {
        const formatted = formatShopItemForResponse(itemRow);
        return {
          id: formatted.id,
          price_gold: formatted.price_gold,
          price_hours: formatted.price_hours,
          available: formatted.available,
          coming_soon: formatted.coming_soon,
        };
      })()
    : null;

  if (!user) {
    return {
      item,
      isLoggedIn: false,
      gold: 0,
      hasShipped: null,
      alreadyPurchased: false,
      attended: false,
      hasCertificate: false,
      certificateCode: null,
      approvedHours: 0,
      qualifyHours: EVENT_QUALIFY_HOURS,
      autoQualified: false,
    };
  }

  // Unlike /api/users/balance this includes pending build-proof gold, mirroring
  // canPurchaseWithPendingGold in lib/shop.ts (event-tied items accept it).
  const [balanceRows, hasShipped, eligibility] = await Promise.all([
    db
      .select({
        balance: sql<number>`
          COALESCE(SUM(
            CASE WHEN ${currencyTransactionTable.type} = 'increase'
              THEN ${currencyTransactionTable.amount}
              ELSE -${currencyTransactionTable.amount}
            END
          ), 0)
        `.mapWith(Number),
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, user.id),
          eq(currencyTransactionTable.counts, true),
          isNull(currencyTransactionTable.fruit_type),
        ),
      ),
    userHasShippedProject(user.id),
    getCertificateEligibility(user.id),
  ]);

  return {
    item,
    isLoggedIn: true,
    gold: balanceRows[0]?.balance ?? 0,
    hasShipped,
    alreadyPurchased: eligibility.event_invite_purchased,
    attended: eligibility.attended,
    hasCertificate: eligibility.has_certificate,
    certificateCode: eligibility.code,
    // Reused from the certificate eligibility payload rather than queried again.
    approvedHours: eligibility.eligible_hours,
    qualifyHours: EVENT_QUALIFY_HOURS,
    autoQualified: eligibility.eligible_hours >= EVENT_QUALIFY_HOURS,
  };
});
