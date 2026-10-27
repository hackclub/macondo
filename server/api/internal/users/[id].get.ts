import db from "../../../db";
import {
  auditLogTable,
  currencyTransactionTable,
  internalNotesTable,
  projectGrantTable,
  users,
  shadowBanTable,
  macondoBanTable,
  shipTable,
  projectTable,
  shopOrderTable,
  streakDaysTable,
  sessions,
  referralVisitsTable,
} from "../../../db/schema";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { writeAudit } from "../../../lib/audit";
import { getTrustLevelForUser } from "../../../lib/hackatime";
import { notifySelfProfileAccess } from "../../../lib/self-project-access-alert";
import {
  canAccessInternalShopAdmin,
  canImpersonateUser,
  canManageInternalNotes,
  canViewUser,
  isAbleToHandlePII,
  redactProjectForInternal,
} from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  const id = getRouterParam(event, "id")!;

  const [target] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!target)
    throw createError({ statusCode: 404, statusMessage: "Not Found" });
  
  if (!canViewUser(actor, target)) {
    if (actor.id === target.id) {
      try {
        await writeAudit({
          actor_id: actor.id,
          action: "attempt_view_own_internal_profile",
          entity_type: "user",
          entity_id: id,
          old_value: null,
          new_value: {
            allowed: false,
            reason: "self_view_requires_supaadmin",
          },
          sensitive: true,
          public_message: null,
          change_summary: "Attempted to view own internal profile without supaadmin",
        });
      } catch (error) {
        console.error("Failed to write audit log for blocked self-profile view", error);
      }

      try {
        await notifySelfProfileAccess({ actor });
      } catch (error) {
        console.error("Failed to send self-profile DM alert", error);
      }
    }

    throw createError({ statusCode: 403, statusMessage: "You can't see your own profile data on the internal dashboard" });
  }

  // Non-supaadmins get an empty grants array so the feature's existence doesn't leak.
  const showGrants = canAccessInternalShopAdmin(actor);
  const showPii = isAbleToHandlePII(actor);

  const [
    shadowBans,
    ships,
    projects,
    audits,
    transactions,
    internalNotes,
    grants,
    orders,
    streakDays,
    goldRows,
    fruitRows,
    sessionRows,
    referralVisits,
    macondoBans,
  ] = await Promise.all([
    db
      .select()
      .from(shadowBanTable)
      .where(eq(shadowBanTable.user_id, id)),
    db
      .select({ ship: shipTable, project: projectTable })
      .from(shipTable)
      .leftJoin(projectTable, eq(shipTable.project_id, projectTable.id))
      .where(eq(shipTable.user_id, id)),
    db.select().from(projectTable).where(eq(projectTable.user_id, id)),
    db
      .select({
        id: auditLogTable.id,
        action: auditLogTable.action,
        entity_type: auditLogTable.entity_type,
        entity_id: auditLogTable.entity_id,
        old_value: auditLogTable.old_value,
        new_value: auditLogTable.new_value,
        public_message: auditLogTable.public_message,
        change_summary: auditLogTable.change_summary,
        sensitive: auditLogTable.sensitive,
        created_at: auditLogTable.created_at,
        actor: {
          id: users.id,
          name: users.name,
          image: users.image,
          slack_id: users.slack_id,
          username: users.username,
        },
      })
      .from(auditLogTable)
      .leftJoin(users, eq(auditLogTable.actor_id, users.id))
      .where(
        and(
          eq(auditLogTable.entity_type, "user"),
          eq(auditLogTable.entity_id, id),
        ),
      )
      .orderBy(desc(auditLogTable.created_at)),
    db
      .select({
        id: currencyTransactionTable.id,
        amount: currencyTransactionTable.amount,
        type: currencyTransactionTable.type,
        source: currencyTransactionTable.source,
        memo: currencyTransactionTable.memo,
        counts: currencyTransactionTable.counts,
        created_at: currencyTransactionTable.created_at,
        ship_id: currencyTransactionTable.ship_id,
        shop_order_id: currencyTransactionTable.shop_order_id,
        created_by_user_id: currencyTransactionTable.created_by_user_id,
        createdBy: {
          id: users.id,
          name: users.name,
          image: users.image,
          slack_id: users.slack_id,
          username: users.username,
        },
      })
      .from(currencyTransactionTable)
      .leftJoin(users, eq(currencyTransactionTable.created_by_user_id, users.id))
      .where(eq(currencyTransactionTable.user_id, id))
      .orderBy(desc(currencyTransactionTable.created_at)),
    db
      .select({
        id: internalNotesTable.id,
        note: internalNotesTable.note,
        created_at: internalNotesTable.created_at,
        updated_at: internalNotesTable.updated_at,
        created_by: internalNotesTable.created_by,
        author: {
          id: users.id,
          name: users.name,
          image: users.image,
          slack_id: users.slack_id,
          username: users.username,
        },
      })
      .from(internalNotesTable)
      .leftJoin(users, eq(internalNotesTable.created_by, users.id))
      .where(eq(internalNotesTable.user_id, id))
      .orderBy(desc(internalNotesTable.updated_at), desc(internalNotesTable.created_at)),
    showGrants
      ? db
          .select({
            id: projectGrantTable.id,
            project_id: projectGrantTable.project_id,
            ship_id: projectGrantTable.ship_id,
            amount_cents: projectGrantTable.amount_cents,
            status: projectGrantTable.status,
            hcb_grant_id: projectGrantTable.hcb_grant_id,
            cancel_reason: projectGrantTable.cancel_reason,
            reissued_from_id: projectGrantTable.reissued_from_id,
            created_at: projectGrantTable.created_at,
            sent_at: projectGrantTable.sent_at,
            cancelled_at: projectGrantTable.cancelled_at,
            project: {
              id: projectTable.id,
              name: projectTable.name,
              fruit: projectTable.fruit,
            },
          })
          .from(projectGrantTable)
          .innerJoin(
            projectTable,
            eq(projectGrantTable.project_id, projectTable.id),
          )
          .where(eq(projectGrantTable.user_id, id))
          .orderBy(desc(projectGrantTable.created_at))
      : Promise.resolve([]),
    // item_snapshot keeps the historical name and price across later item edits.
    showGrants
      ? db
          .select({
            id: shopOrderTable.id,
            status: shopOrderTable.status,
            quantity: shopOrderTable.quantity,
            item_snapshot: shopOrderTable.item_snapshot,
            selected_modifiers: shopOrderTable.selected_modifiers,
            external_reference: shopOrderTable.external_reference,
            fulfillment_error: shopOrderTable.fulfillment_error,
            region: shopOrderTable.region,
            tracking_number: shopOrderTable.tracking_number,
            created_at: shopOrderTable.created_at,
            updated_at: shopOrderTable.updated_at,
          })
          .from(shopOrderTable)
          .where(eq(shopOrderTable.user_id, id))
          .orderBy(desc(shopOrderTable.created_at))
      : Promise.resolve([]),
    db
      .select({
        day: streakDaysTable.day,
        status: streakDaysTable.status,
        seconds_logged: streakDaysTable.seconds_logged,
        had_journal: streakDaysTable.had_journal,
        created_at: streakDaysTable.created_at,
        updated_at: streakDaysTable.updated_at,
      })
      .from(streakDaysTable)
      .where(eq(streakDaysTable.user_id, id))
      .orderBy(desc(streakDaysTable.day))
      .limit(14), // last two weeks of streak days
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
          eq(currencyTransactionTable.user_id, id),
          eq(currencyTransactionTable.counts, true),
          isNull(currencyTransactionTable.fruit_type),
          isNotNull(currencyTransactionTable.unlocked_at),
        ),
      ),
    // Pending rows are skipped so the inventory matches what the user can spend.
    db
      .select({
        fruit_type: currencyTransactionTable.fruit_type,
        balance: sql<number>`
          SUM(
            CASE WHEN ${currencyTransactionTable.type} = 'increase'
              THEN ${currencyTransactionTable.amount}
              ELSE -${currencyTransactionTable.amount}
            END
          )
        `.mapWith(Number),
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, id),
          eq(currencyTransactionTable.counts, true),
          isNotNull(currencyTransactionTable.fruit_type),
          isNotNull(currencyTransactionTable.unlocked_at),
        ),
      )
      .groupBy(currencyTransactionTable.fruit_type)
      .having(sql`SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase' THEN ${currencyTransactionTable.amount} ELSE -${currencyTransactionTable.amount} END) <> 0`),
    // Token column excluded so the live cookie value never reaches the wire.
    showPii
      ? db
          .select({
            id: sessions.id,
            created_at: sessions.createdAt,
            expires_at: sessions.expiresAt,
            ip_address: sessions.ipAddress,
            user_agent: sessions.userAgent,
          })
          .from(sessions)
          .where(eq(sessions.userId, id))
          .orderBy(desc(sessions.createdAt))
          .limit(100)
      : Promise.resolve([] as Array<{
          id: string;
          created_at: Date;
          expires_at: Date;
          ip_address: string | null;
          user_agent: string | null;
        }>),
    // Pre-patch session IPs are NULL, so this is the source of historical IPs.
    showPii
      ? db
          .select({
            id: referralVisitsTable.id,
            created_at: referralVisitsTable.created_at,
            ip_address: referralVisitsTable.ip_address,
            user_agent: referralVisitsTable.user_agent,
            landing_path: referralVisitsTable.landing_path,
            referer: referralVisitsTable.referer,
            utm_source: referralVisitsTable.utm_source,
          })
          .from(referralVisitsTable)
          .where(eq(referralVisitsTable.user_id, id))
          .orderBy(desc(referralVisitsTable.created_at))
          .limit(100)
      : Promise.resolve([] as Array<{
          id: number;
          created_at: Date;
          ip_address: string | null;
          user_agent: string | null;
          landing_path: string;
          referer: string | null;
          utm_source: string | null;
        }>),
    db
      .select()
      .from(macondoBanTable)
      .where(eq(macondoBanTable.user_id, id))
      .orderBy(desc(macondoBanTable.created_at)),
  ]);

  const activeShadowBans = shadowBans.filter((ban) => ban.active);
  // Mirrors getActiveMacondoBan so the UI agrees with enforcement.
  const nowMs = Date.now();
  const activeMacondoBan =
    macondoBans.find(
      (ban) =>
        ban.active &&
        (!ban.expires_at || ban.expires_at.getTime() > nowMs),
    ) ?? null;
  const config = useRuntimeConfig();
  const hackatimeTrustLevel = await getTrustLevelForUser({
    adminKey: (config.hackatimeAdminKey as string | undefined) ?? null,
    hackatimeId: target.hackatime_id,
    hackatimeOAuthToken: target.hackatime_oauth_token,
    email: target.email,
  });

  // invite_code is a bearer capability and guide sources are the learner's work;
  // neither belongs in a review payload.
  const safeShips = ships.map((row) => ({
    ...row,
    project: redactProjectForInternal(row.project),
  }));

  // Strip live bearer tokens and PII before spreading, or the showPii gate below does nothing.
  const {
    github_token: _githubToken,
    hackatime_oauth_token: _hackatimeToken,
    hca_refresh_token: _hcaRefreshToken,
    sub: _sub,
    email: _email,
    hcb_email: _hcbEmail,
    ...targetSafe
  } = target;

  return {
    ...targetSafe,
    canImpersonate: canImpersonateUser(actor, target),
    hackatimeTrustLevel,
    image: target.image,
    isShadowBanned: activeShadowBans.length > 0,
    shadowBans: activeShadowBans,
    isMacondoBanned: !!activeMacondoBan,
    activeMacondoBan,
    macondoBans,
    totalHackatimeHours: ships.reduce(
      (sum, row) => sum + (row.ship.hackatime_hours ?? 0),
      0,
    ),
    shippedShipCount: ships.filter(
      (row) => row.ship.status === "shipped",
    ).length,
    pendingShipCount: ships.filter((row) =>
      ["under_review", "pending_fraud_review"].includes(row.ship.status),
    ).length,
    projects: projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        fruit: project.fruit,
        level: project.level,
        stage: project.stage,
        demo_url: project.demo_url,
        repository_url: project.repository_url,
        created_at: project.created_at,
        project_streak_days: project.project_streak_days,
        last_worked_date: project.last_worked_date,
        hackatime_projects: project.hackatime_projects,
      }))
      .sort((a, b) => (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0)),
    ships: safeShips,
    audits: audits.map((entry) => ({
      ...entry,
      actor: entry.actor?.id
        ? {
            ...entry.actor,
          }
        : null,
    })),
    transactions: transactions.map((entry) => ({
      ...entry,
      createdBy: entry.createdBy?.id
        ? {
            ...entry.createdBy,
          }
        : null,
    })),
    internalNotes: canManageInternalNotes(actor)
      ? internalNotes.map((entry) => ({
          ...entry,
          author: entry.author?.id
            ? {
                ...entry.author,
              }
            : null,
        }))
      : [],
    grants,
    orders,
    streakDays,
    linkedHackatimeNames: Array.from(
      new Set(
        projects.flatMap((project) => project.hackatime_projects ?? []),
      ),
    ).sort(),
    currencyBalances: {
      gold: goldRows[0]?.balance ?? 0,
      fruits: (fruitRows ?? [])
        .filter((row) => row.fruit_type)
        .map((row) => ({
          fruit_type: row.fruit_type as string,
          balance: row.balance ?? 0,
        }))
        .sort((a, b) => b.balance - a.balance),
    },
    ...(showPii
      ? {
          email: target.email,
          hcb_email: target.hcb_email,
          sessions: sessionRows,
          referralVisits,
        }
      : {}),
  };
});
