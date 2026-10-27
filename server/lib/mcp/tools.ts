// callers are verified supaadmins, so reads are unscoped. write tools reuse the internal UI's
// lib paths so currency/role/ticket rules, audit and notifications fire identically.
import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import db from "../../db";
import {
  auditLogTable,
  currencyTransactionTable,
  journalsTable,
  macondoBanTable,
  projectTable,
  shadowBanTable,
  shipTable,
  shopItemTable,
  shopOrderTable,
  streakDaysTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../../db/schema";
import { writeAudit } from "../audit";
import { adjustUserGold } from "../gold-adjust";
import { setUserRoles } from "../user-roles";
import {
  fanOutResolveSideEffects,
  markTicketResolved,
} from "../support-ticket-resolve";
import {
  getStreakCalendar,
  getUserCurrentStreak,
  requalifyPendingStreakDaysForUser,
} from "../streaks";
import { refundStreakFreeze } from "../streak-freeze-refund";
import { healStreakDay } from "../streak-heal";
import {
  computeWorkAvailableReviewProtectedDays,
  isGapLeapBridge,
  masterToggleAt,
  planReviewProtectionBackfill,
  shiftDayStr,
  streakDayKey,
  yesterdayStr,
} from "../streak-helpers";
import { markShipRejected } from "../review-actions";
import { revertShipApproval } from "../revert-ship";
import { computeFruitReward, computeGoldReward, parseLevel } from "../rewards";
import {
  fetchFineById,
  fetchFines,
  extractMacondoRecordId,
  resolveFineToUnifiedProject,
  type FineResolution,
} from "../fines";
import {
  getFruitsByLevelAndCategory,
  levelConfig,
  type ProjectCategory,
} from "../../../app/data/fruitLevels";
import type { McpContext } from "./auth";

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Tool {
  spec: ToolSpec;
  write?: boolean;
  handler: (args: Record<string, unknown>, ctx: McpContext) => Promise<unknown>;
}

function requireWrite(ctx: McpContext): void {
  if (!ctx.canWrite) {
    throw new Error(
      "This token is read-only. Mint a read-write token to use write tools.",
    );
  }
}

function clampLimit(n: unknown, def = 25, max = 100): number {
  return Math.min(Math.max(typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def, 1), max);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

// mirrors the finance UI and gold-adjustment balance computation
async function goldBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`COALESCE(SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase' THEN ${currencyTransactionTable.amount} ELSE -${currencyTransactionTable.amount} END), 0)`,
    })
    .from(currencyTransactionTable)
    .where(
      and(
        eq(currencyTransactionTable.user_id, userId),
        eq(currencyTransactionTable.counts, true),
        isNull(currencyTransactionTable.fruit_type),
        isNotNull(currencyTransactionTable.unlocked_at),
      ),
    );
  return Number(row?.balance ?? 0);
}

// bounded workers so list_fines doesn't fire every Airtable request at once
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

interface FineShipSummary {
  id: number;
  status: string;
  override_hours: number | null;
}
interface FineProjectSummary {
  id: number;
  name: string;
  type: string;
  level: string | null;
  owner_user_id: string | null;
  ships: FineShipSummary[];
}
interface FineMacondoResolution {
  source: FineResolution["source"];
  source_note: string | null;
  reviewer: string | null;
  // `reason` prefers the third review (the real human call) over the first-review stub
  verdict: string | null;
  reason: string | null;
  first_review: { status: string | null; notes: string | null };
  third_review: { status: string | null; notes: string | null };
  maker_name: string | null;
  maker_email: string | null;
  unified_code_url: string | null;
  unified_playable_url: string | null;
  unified_override_hours: number | null;
  unified_approved_at: string | null;
  macondo_user: { id: string; name: string; email: string } | null;
  projects: FineProjectSummary[];
}

// a repo shipped as several projects surfaces all of them, so the operator sees the full blast radius
async function resolveFineToMacondo(
  res: FineResolution,
): Promise<FineMacondoResolution> {
  let macondoUser: { id: string; name: string; email: string } | null = null;
  if (res.email) {
    const [u] = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${res.email})`)
      .limit(1);
    macondoUser = u ?? null;
  }

  const projects: FineProjectSummary[] = [];
  if (res.codeUrl) {
    const projRows = await db
      .select({
        id: projectTable.id,
        name: projectTable.name,
        type: projectTable.type,
        level: projectTable.level,
        user_id: projectTable.user_id,
      })
      .from(projectTable)
      .where(eq(projectTable.repository_url, res.codeUrl));
    for (const p of projRows) {
      const ships = await db
        .select({
          id: shipTable.id,
          status: shipTable.status,
          override_hours: shipTable.override_hours,
        })
        .from(shipTable)
        .where(eq(shipTable.project_id, p.id))
        .orderBy(desc(shipTable.created_at));
      projects.push({
        id: p.id,
        name: p.name,
        type: p.type,
        level: p.level,
        owner_user_id: p.user_id,
        ships: ships.map((s) => ({
          id: s.id,
          status: s.status,
          override_hours: s.override_hours != null ? Number(s.override_hours) : null,
        })),
      });
    }
  }

  return {
    source: res.source,
    source_note: res.sourceNote,
    reviewer: res.reviewer,
    verdict: res.verdict,
    reason: res.reason,
    first_review: {
      status: res.firstReviewStatus,
      notes: res.firstReviewNotes,
    },
    third_review: {
      status: res.thirdReviewStatus,
      notes: res.thirdReviewNotes,
    },
    maker_name: res.makerName,
    maker_email: res.email,
    unified_code_url: res.codeUrl,
    unified_playable_url: res.playableUrl,
    unified_override_hours: res.overrideHours,
    unified_approved_at: res.approvedAt,
    macondo_user: macondoUser,
    projects,
  };
}

async function activeBans(userId: string): Promise<{
  shadow_banned: boolean;
  banned: boolean;
}> {
  const [shadow] = await db
    .select({ id: shadowBanTable.id })
    .from(shadowBanTable)
    .where(and(eq(shadowBanTable.user_id, userId), eq(shadowBanTable.active, true)))
    .limit(1);
  const [ban] = await db
    .select({ id: macondoBanTable.id })
    .from(macondoBanTable)
    .where(and(eq(macondoBanTable.user_id, userId), eq(macondoBanTable.active, true)))
    .limit(1);
  return { shadow_banned: !!shadow, banned: !!ban };
}

const USER_FIELDS = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  slack_id: users.slack_id,
  roles: users.roles,
  country: users.country,
  hca_verification_status: users.hca_verification_status,
  hca_ysws_eligible: users.hca_ysws_eligible,
  created_at: users.createdAt,
  last_seen_at: users.last_seen_at,
} as const;

const tools: Tool[] = [
  {
    spec: {
      name: "whoami",
      description:
        "Identity behind the current MCP token: the supaadmin who owns it, the token label, and whether it has the read-write scope.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async (_args, ctx) => ({
      user: {
        id: ctx.user.id,
        name: ctx.user.name,
        email: ctx.user.email,
        roles: ctx.user.roles ?? [],
      },
      token_label: ctx.tokenLabel,
      can_write: ctx.canWrite,
    }),
  },

  {
    spec: {
      name: "find_user",
      description:
        "Find users by a free-text query matched against id (exact), email (exact, case-insensitive), Slack id (exact), username (case-insensitive), and name (case-insensitive substring). Returns roles, identity-verification status, gold balance, and ban state.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Email, Slack id, username, name, or user id." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const q = str(args.query);
      if (!q) throw new Error("Provide a non-empty query.");
      const rows = await db
        .select(USER_FIELDS)
        .from(users)
        .where(
          or(
            eq(users.id, q),
            ilike(users.email, q),
            eq(users.slack_id, q),
            ilike(users.username, q),
            ilike(users.name, `%${q}%`),
          ),
        )
        .orderBy(desc(users.createdAt))
        .limit(clampLimit(args.limit));
      return Promise.all(
        rows.map(async (u) => ({
          ...u,
          gold_balance: await goldBalance(u.id),
          ...(await activeBans(u.id)),
        })),
      );
    },
  },
  {
    spec: {
      name: "get_user",
      description:
        "Full detail for one user: profile, roles, identity-verification status, gold balance, ban state, and counts of their projects, ships, and shop orders.",
      inputSchema: {
        type: "object",
        properties: { userId: { type: "string", description: "The user's id." } },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      const [u] = await db
        .select(USER_FIELDS)
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!u) throw new Error(`No user with id "${id}".`);
      const [[projects], [ships], [orders]] = await Promise.all([
        db
          .select({ n: sql<number>`count(*)` })
          .from(projectTable)
          .where(eq(projectTable.user_id, id)),
        db
          .select({ n: sql<number>`count(*)` })
          .from(shipTable)
          .where(eq(shipTable.user_id, id)),
        db
          .select({ n: sql<number>`count(*)` })
          .from(shopOrderTable)
          .where(eq(shopOrderTable.user_id, id)),
      ]);
      return {
        ...u,
        gold_balance: await goldBalance(id),
        ...(await activeBans(id)),
        project_count: Number(projects?.n ?? 0),
        ship_count: Number(ships?.n ?? 0),
        order_count: Number(orders?.n ?? 0),
      };
    },
  },
  {
    spec: {
      name: "list_users",
      description:
        "List users, optionally filtered to those holding a given role (e.g. supaadmin, admin, software_reviewer). Newest first.",
      inputSchema: {
        type: "object",
        properties: {
          role: { type: "string", description: "Only users whose roles array contains this." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const role = str(args.role);
      const where = role ? arrayContains(users.roles, [role]) : undefined;
      return db
        .select(USER_FIELDS)
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(clampLimit(args.limit));
    },
  },

  {
    spec: {
      name: "get_project",
      description:
        "A project with its owner, recent ships, and recent journals. Includes type, level, stage, fruit, repository and demo URLs, and per-project streak.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "number", description: "The project id." },
          limit: { type: "number", description: "Max ships/journals each (default 10, max 100)." },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = Number(args.projectId);
      if (!Number.isInteger(id)) throw new Error("projectId must be a number.");
      const [p] = await db.select().from(projectTable).where(eq(projectTable.id, id)).limit(1);
      if (!p) throw new Error(`No project with id ${id}.`);
      const lim = clampLimit(args.limit, 10);
      const owner = (p.user_id
        ? await db.select(USER_FIELDS).from(users).where(eq(users.id, p.user_id)).limit(1)
        : [])[0] ?? null;
      const ships = await db
        .select({
          id: shipTable.id,
          status: shipTable.status,
          hackatime_hours: shipTable.hackatime_hours,
          override_hours: shipTable.override_hours,
          is_update: shipTable.is_update,
          created_at: shipTable.created_at,
          reviewed_at: shipTable.reviewed_at,
        })
        .from(shipTable)
        .where(eq(shipTable.project_id, id))
        .orderBy(desc(shipTable.id))
        .limit(lim);
      return {
        project: p,
        owner: owner ?? null,
        ships,
        journals: await db
          .select({
            id: journalsTable.id,
            short_brief: journalsTable.short_brief,
            hours: journalsTable.hours,
            approved: journalsTable.approved,
            created_at: journalsTable.created_at,
          })
          .from(journalsTable)
          .where(eq(journalsTable.project_id, id))
          .orderBy(desc(journalsTable.id))
          .limit(lim),
      };
    },
  },
  {
    spec: {
      name: "list_ships",
      description:
        "Ship submissions, optionally filtered by status (e.g. under_review, pending_second_pass, pending_fraud_review, shipped, needs_changes, rejected). Newest first.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Exact ship status to filter by." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const status = str(args.status);
      return db
        .select({
          id: shipTable.id,
          user_id: shipTable.user_id,
          project_id: shipTable.project_id,
          status: shipTable.status,
          hackatime_hours: shipTable.hackatime_hours,
          override_hours: shipTable.override_hours,
          assigned_user_id: shipTable.assigned_user_id,
          is_update: shipTable.is_update,
          needs_funding: shipTable.needs_funding,
          created_at: shipTable.created_at,
          reviewed_at: shipTable.reviewed_at,
        })
        .from(shipTable)
        .where(status ? eq(shipTable.status, status as typeof shipTable.status.enumValues[number]) : undefined)
        .orderBy(desc(shipTable.id))
        .limit(clampLimit(args.limit));
    },
  },
  {
    spec: {
      name: "get_ship",
      description:
        "Full detail for one ship: approved hours, reviewer decision message and audit notes, AI-disclosure and funding flags, and a summary of the fraud (ARI, YSWS Fraud) check state.",
      inputSchema: {
        type: "object",
        properties: { shipId: { type: "number", description: "The ship id." } },
        required: ["shipId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = Number(args.shipId);
      if (!Number.isInteger(id)) throw new Error("shipId must be a number.");
      const [s] = await db.select().from(shipTable).where(eq(shipTable.id, id)).limit(1);
      if (!s) throw new Error(`No ship with id ${id}.`);
      const [owner] = await db.select(USER_FIELDS).from(users).where(eq(users.id, s.user_id)).limit(1);
      const [project] = await db
        .select({ id: projectTable.id, name: projectTable.name, type: projectTable.type, level: projectTable.level })
        .from(projectTable)
        .where(eq(projectTable.id, s.project_id))
        .limit(1);
      return {
        id: s.id,
        status: s.status,
        user: owner ?? null,
        project: project ?? null,
        hackatime_hours: s.hackatime_hours,
        override_hours: s.override_hours,
        software_override_hours: s.software_override_hours,
        needs_funding: s.needs_funding,
        needs_funding_amount_cents: s.needs_funding_amount_cents,
        used_ai: s.used_ai,
        ai_usage_description: s.ai_usage_description,
        is_update: s.is_update,
        update_description: s.update_description,
        assigned_user_id: s.assigned_user_id,
        decision_user_message: s.decision_user_message,
        decision_audit_notes: s.decision_audit_notes,
        reviewed_at: s.reviewed_at,
        created_at: s.created_at,
        checks: {
          ari_status: s.ari_status,
          fraud_trust_score: s.fraud_trust_score,
          fraud_outcome: s.fraud_outcome,
        },
      };
    },
  },
  {
    spec: {
      name: "get_ship_reward",
      description:
        "Remediation preflight for a ship: its status, approved/override hours, the frozen reward snapshot, the project level/fruit, the LIVE ship_reward + review_reward ledger rows (amount, memo, counts), the owner's current spendable gold, and any active project grants. Read this before any clawback/deflation to see what was paid and whether the owner has already spent it.",
      inputSchema: {
        type: "object",
        properties: { shipId: { type: "number", description: "The ship id." } },
        required: ["shipId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = Number(args.shipId);
      if (!Number.isInteger(id)) throw new Error("shipId must be a number.");
      const [s] = await db.select().from(shipTable).where(eq(shipTable.id, id)).limit(1);
      if (!s) throw new Error(`No ship with id ${id}.`);
      const [project] = await db
        .select({ id: projectTable.id, name: projectTable.name, type: projectTable.type, level: projectTable.level, fruit: projectTable.fruit })
        .from(projectTable)
        .where(eq(projectTable.id, s.project_id))
        .limit(1);
      const rewardRows = await db
        .select({
          id: currencyTransactionTable.id,
          amount: currencyTransactionTable.amount,
          type: currencyTransactionTable.type,
          source: currencyTransactionTable.source,
          fruit_type: currencyTransactionTable.fruit_type,
          memo: currencyTransactionTable.memo,
          counts: currencyTransactionTable.counts,
          unlocked_at: currencyTransactionTable.unlocked_at,
          created_at: currencyTransactionTable.created_at,
        })
        .from(currencyTransactionTable)
        .where(eq(currencyTransactionTable.ship_id, id))
        .orderBy(desc(currencyTransactionTable.id));
      return {
        ship: {
          id: s.id,
          status: s.status,
          user_id: s.user_id,
          hackatime_hours: s.hackatime_hours,
          override_hours: s.override_hours,
          software_override_hours: s.software_override_hours,
          reviewed_at: s.reviewed_at,
          airtable_record_id: s.airtable_record_id,
          override_reason: s.override_reason,
          second_pass_gold_reward: s.second_pass_gold_reward,
          second_pass_multiplier: s.second_pass_multiplier,
          second_pass_assigned_fruit: s.second_pass_assigned_fruit,
        },
        project: project ?? null,
        owner_gold_balance: await goldBalance(s.user_id),
        ledger_rows: rewardRows,
      };
    },
  },
  {
    spec: {
      name: "list_journals",
      description: "Journal devlog entries for a project, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "number", description: "The project id." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        required: ["projectId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = Number(args.projectId);
      if (!Number.isInteger(id)) throw new Error("projectId must be a number.");
      return db
        .select({
          id: journalsTable.id,
          user_id: journalsTable.user_id,
          short_brief: journalsTable.short_brief,
          long_brief: journalsTable.long_brief,
          hours: journalsTable.hours,
          approved: journalsTable.approved,
          reviewed: journalsTable.reviewed,
          archived: journalsTable.archived,
          created_at: journalsTable.created_at,
        })
        .from(journalsTable)
        .where(eq(journalsTable.project_id, id))
        .orderBy(desc(journalsTable.id))
        .limit(clampLimit(args.limit));
    },
  },

  {
    spec: {
      name: "get_user_streak",
      description:
        "A user's streak state: headline day-run streak (the streak_days run the dashboard shows), best per-project streak, freeze wallet (streak_freezes_remaining + auto_use toggle), last_active_date, timezone, and every project's streak (project_streak_days, last_worked_date, stage).",
      inputSchema: {
        type: "object",
        properties: { userId: { type: "string", description: "The user's id." } },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      const [u] = await db
        .select({
          id: users.id,
          name: users.name,
          timezone: users.timezone,
          last_active_date: users.last_active_date,
          streak_freezes_remaining: users.streak_freezes_remaining,
          auto_use_streak_freezes: users.auto_use_streak_freezes,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!u) throw new Error(`No user with id "${id}".`);
      const projects = await db
        .select({
          id: projectTable.id,
          name: projectTable.name,
          type: projectTable.type,
          project_streak_days: projectTable.project_streak_days,
          last_worked_date: projectTable.last_worked_date,
          stage: projectTable.stage,
          auto_use_streak_freezes: projectTable.auto_use_streak_freezes,
        })
        .from(projectTable)
        .where(eq(projectTable.user_id, id))
        .orderBy(desc(projectTable.project_streak_days));
      const headline = await getUserCurrentStreak(id, u.timezone);
      const maxProjectStreak = projects.reduce(
        (m, p) => Math.max(m, p.project_streak_days),
        0,
      );
      return {
        user: { id: u.id, name: u.name, timezone: u.timezone },
        headline_streak: headline,
        dashboard_streak: Math.max(headline, maxProjectStreak),
        best_project_streak: maxProjectStreak,
        last_active_date: u.last_active_date,
        streak_freezes_remaining: u.streak_freezes_remaining,
        auto_use_streak_freezes: u.auto_use_streak_freezes,
        projects,
      };
    },
  },
  {
    spec: {
      name: "get_streak_calendar",
      description:
        "A user's streak_days rows (one per day) over a window, with status (pending/active/frozen/missed/review_protected), seconds_logged, and had_journal. This is the source of truth the profile calendar renders.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "The user's id." },
          days: { type: "number", description: "Trailing window length in days (default 45, max 400)." },
          endDay: { type: "string", description: "End of the window, YYYY-MM-DD (default today UTC)." },
        },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      const endStr = str(args.endDay) ?? new Date().toISOString().slice(0, 10);
      const endDate = new Date(endStr + "T00:00:00Z");
      if (Number.isNaN(endDate.getTime())) throw new Error("endDay must be YYYY-MM-DD.");
      const start = new Date(endDate);
      start.setUTCDate(start.getUTCDate() - (clampLimit(args.days, 45, 400) - 1));
      const startStr = start.toISOString().slice(0, 10);
      return { user_id: id, start_day: startStr, end_day: endStr, days: await getStreakCalendar(id, startStr, endStr) };
    },
  },
  {
    spec: {
      name: "list_streak_events",
      description:
        "A user's streak audit history: all_streaks_reset, freeze grants/consumes/refunds, and streak_day_heal rows, newest first. Use this to see why a streak broke or what freezes were burned/refunded.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "The user's id." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      return db
        .select({
          id: auditLogTable.id,
          action: auditLogTable.action,
          old_value: auditLogTable.old_value,
          new_value: auditLogTable.new_value,
          public_message: auditLogTable.public_message,
          created_at: auditLogTable.created_at,
        })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.entity_type, "user"),
            eq(auditLogTable.entity_id, id),
            inArray(auditLogTable.action, [
              "all_streaks_reset",
              "streak_freeze_grant",
              "streak_freeze_consumed",
              "streak_freeze_refund",
              "streak_freeze_used",
              "streak_day_heal",
            ]),
          ),
        )
        .orderBy(desc(auditLogTable.id))
        .limit(clampLimit(args.limit));
    },
  },

  {
    spec: {
      name: "list_freeze_burns",
      description:
        "Fleet-wide streak-freeze burns (the engine's auto-consume) over a trailing window, newest first, with the frozen day(s) and the resulting wallet balance. The read side of the freeze-burn cohort audits. Optionally filter to one user.",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Lookback window in days (default 30, max 365)." },
          userId: { type: "string", description: "Optional: only this user's burns." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const days = clampLimit(args.days, 30, 365);
      const userId = str(args.userId);
      const conds = [
        eq(auditLogTable.action, "streak_freeze_consumed"),
        sql`${auditLogTable.created_at} >= now() - make_interval(days => ${days})`,
      ];
      if (userId) conds.push(eq(auditLogTable.entity_id, userId));
      return db
        .select({
          id: auditLogTable.id,
          user_id: auditLogTable.entity_id,
          new_value: auditLogTable.new_value,
          old_value: auditLogTable.old_value,
          created_at: auditLogTable.created_at,
        })
        .from(auditLogTable)
        .where(and(...conds))
        .orderBy(desc(auditLogTable.id))
        .limit(clampLimit(args.limit));
    },
  },
  {
    spec: {
      name: "freeze_inventory_distribution",
      description:
        "Global histogram of the streak-freeze wallet across all users (count of users at each streak_freezes_remaining value) plus the auto-use master-toggle split. The read companion to the freeze-inventory audit.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    handler: async () => {
      const wallet = await db
        .select({ freezes: users.streak_freezes_remaining, n: sql<number>`count(*)::int` })
        .from(users)
        .groupBy(users.streak_freezes_remaining)
        .orderBy(users.streak_freezes_remaining);
      return {
        freeze_wallet_histogram: wallet,
        auto_use_split: await db
          .select({ auto_use: users.auto_use_streak_freezes, n: sql<number>`count(*)::int` })
          .from(users)
          .groupBy(users.auto_use_streak_freezes),
      };
    },
  },

  {
    spec: {
      name: "get_stranded_gapbridge_cohort",
      description:
        "Read-only detector for the stranded-freeze GAP-BRIDGE bug: real stranded burns (streak_freeze_backfill_stranded, comp=false, freeze decremented) whose bridged day is STILL frozen but, under the gap-aware rule, only reached an anchor by leaping a calendar gap (so the freeze was wrongly spent). Skips already-refunded days. Returns candidate (user, day) refunds; the actual refund stays in the deployed path.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max flagged candidates (default 50, max 500)." },
          sinceDays: { type: "number", description: "Only scan stranded burns from the last N days (default 90, max 365)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const cap = clampLimit(args.limit, 50, 500);
      const sinceDays = clampLimit(args.sinceDays, 90, 365);
      // bounded so a fleet-wide set can't blow the sync MCP timeout; partial coverage shows in `truncated`
      const MAX_USERS_SCANNED = 120;
      const burns = await db
        .select({
          id: auditLogTable.id,
          entity_id: auditLogTable.entity_id,
          old_value: auditLogTable.old_value,
          new_value: auditLogTable.new_value,
        })
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.action, "streak_freeze_backfill_stranded"),
            sql`${auditLogTable.created_at} >= now() - make_interval(days => ${sinceDays})`,
          ),
        )
        .orderBy(asc(auditLogTable.created_at));
      // real burns (comp=false, decremented), one source burn per (user, day)
      const byUser = new Map<string, Map<string, number>>();
      for (const b of burns) {
        const nv = b.new_value as { comp?: boolean; freezes?: number; frozen_days?: string[] } | null;
        const ov = b.old_value as { freezes?: number } | null;
        const before = ov?.freezes;
        const after = nv?.freezes;
        if (nv?.comp === true || typeof before !== "number" || typeof after !== "number" || !(after < before)) continue;
        const days = Array.isArray(nv?.frozen_days) ? nv!.frozen_days! : [];
        if (!days.length) continue;
        let m = byUser.get(b.entity_id);
        if (!m) { m = new Map(); byUser.set(b.entity_id, m); }
        for (const d of days) if (!m.has(d)) m.set(d, b.id);
      }
      const flags: Array<{ user_id: string; name: string; day: string; freezes_now: number; burn_audit_id: number }> = [];
      let scannedUsers = 0;
      for (const [userId, dayMap] of byUser) {
        if (flags.length >= cap || scannedUsers >= MAX_USERS_SCANNED) break;
        scannedUsers += 1;
        const [u] = await db
          .select({ name: users.name, timezone: users.timezone, streak_freezes_remaining: users.streak_freezes_remaining })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        if (!u) continue;
        const today = streakDayKey(new Date(), u.timezone);
        const candidateDays = [...dayMap.keys()].sort();
        const windowStart = shiftDayStr(candidateDays[0]!, -60);
        const rows = await db
          .select({ day: streakDaysTable.day, status: streakDaysTable.status })
          .from(streakDaysTable)
          .where(and(eq(streakDaysTable.user_id, userId), sql`${streakDaysTable.day} BETWEEN ${windowStart} AND ${today}`));
        const statusByDay = new Map<string, string>(rows.map((r) => [r.day, r.status as string]));
        const refundedRows = await db
          .select({ day: sql<string>`${auditLogTable.new_value}->>'day'` })
          .from(auditLogTable)
          .where(and(eq(auditLogTable.entity_id, userId), inArray(auditLogTable.action, ["streak_freeze_refund", "streak_freeze_refunded_late_activity"])));
        const refunded = new Set(refundedRows.map((r) => r.day));
        for (const day of candidateDays) {
          if (flags.length >= cap) break;
          if (refunded.has(day)) continue;
          if (statusByDay.get(day) !== "frozen") continue;
          if (!isGapLeapBridge(statusByDay, day)) continue;
          flags.push({ user_id: userId, name: u.name, day, freezes_now: u.streak_freezes_remaining, burn_audit_id: dayMap.get(day)! });
        }
      }
      return {
        note: "READ-ONLY detector. Refund via the deployed streak refund path, not from here.",
        since_days: sinceDays,
        total_users_with_stranded_burns: byUser.size,
        scanned_users: scannedUsers,
        truncated: scannedUsers < byUser.size,
        flagged_count: flags.length,
        flags,
      };
    },
  },
  {
    spec: {
      name: "get_optout_freeze_burn_cohort",
      description:
        "Read-only detector: users who had a streak freeze auto-burned while their MASTER auto_use_streak_freezes toggle was OFF at the burn instant (retroactive side of the 2026-06-15 per-project freeze switch). Reconstructs the master toggle at each burn from user_auto_use_freezes_set audits, excludes users who deliberately opted a project IN, and subtracts already-healed (streak_freeze_refund_opted_out) days. Returns affected users + wrongful days + refundable-after-cap.",
      inputSchema: {
        type: "object",
        properties: { since: { type: "string", description: "ISO date floor for burns (default 2026-06-15T00:00:00Z)." } },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const since = str(args.since) ?? "2026-06-15T00:00:00Z";
      const burns = await db
        .select({ user_id: auditLogTable.entity_id, created_at: auditLogTable.created_at, new_value: auditLogTable.new_value })
        .from(auditLogTable)
        .where(and(eq(auditLogTable.action, "streak_freeze_consumed"), sql`${auditLogTable.created_at} >= ${since}`))
        .orderBy(asc(auditLogTable.created_at));
      const userIds = [...new Set(burns.map((b) => b.user_id))];
      if (!userIds.length) return { note: "READ-ONLY detector.", since, affected_users: 0, refundable_after_cap: 0, users: [] };
      const usersRows = await db
        .select({ id: users.id, name: users.name, slack_id: users.slack_id, auto_use_streak_freezes: users.auto_use_streak_freezes, streak_freezes_remaining: users.streak_freezes_remaining })
        .from(users)
        .where(inArray(users.id, userIds));
      const userById = new Map(usersRows.map((u) => [u.id, u]));
      const masterSets = await db
        .select({ entity_id: auditLogTable.entity_id, created_at: auditLogTable.created_at, old_value: auditLogTable.old_value, new_value: auditLogTable.new_value })
        .from(auditLogTable)
        .where(and(eq(auditLogTable.action, "user_auto_use_freezes_set"), inArray(auditLogTable.entity_id, userIds)))
        .orderBy(asc(auditLogTable.created_at));
      const setsByUser = new Map<string, Array<{ atMs: number; oldM: boolean | null; newM: boolean | null }>>();
      const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
      for (const r of masterSets) {
        const ov = r.old_value as Record<string, unknown> | null;
        const nv = r.new_value as Record<string, unknown> | null;
        const arr = setsByUser.get(r.entity_id) ?? [];
        arr.push({ atMs: r.created_at.getTime(), oldM: asBool(ov?.auto_use_streak_freezes), newM: asBool(nv?.auto_use_streak_freezes) });
        setsByUser.set(r.entity_id, arr);
      }
      const deliberateRows = await db
        .select({ user_id: projectTable.user_id })
        .from(projectTable)
        .where(
          and(
            inArray(projectTable.user_id, userIds),
            sql`${projectTable.id}::text IN (SELECT entity_id FROM audit_logs WHERE action = 'project_auto_use_freezes_set' AND entity_type = 'project' AND new_value->>'auto_use_streak_freezes' = 'true')`,
          ),
        );
      const deliberateUsers = new Set(deliberateRows.map((r) => r.user_id).filter((x): x is string => !!x));
      const remediatedRows = await db
        .select({ entity_id: auditLogTable.entity_id, day: sql<string>`${auditLogTable.new_value}->>'day'` })
        .from(auditLogTable)
        .where(and(eq(auditLogTable.action, "streak_freeze_refund_opted_out"), inArray(auditLogTable.entity_id, userIds)));
      const remediatedPairs = new Set(remediatedRows.map((r) => `${r.entity_id}|${r.day}`));
      const affected = new Map<string, { name: string | null; slack: string | null; freezesNow: number; wrongfulDays: string[] }>();
      for (const b of burns) {
        const nv = b.new_value as { frozen_days?: string[] } | null;
        const frozenDays = Array.isArray(nv?.frozen_days) ? nv!.frozen_days! : [];
        if (!frozenDays.length) continue;
        const sets = setsByUser.get(b.user_id) ?? [];
        const u = userById.get(b.user_id);
        if (masterToggleAt({ initial: sets.length > 0 ? (sets[0]!.oldM ?? true) : (u?.auto_use_streak_freezes ?? true), sets, atMs: b.created_at.getTime() })) continue; // master was ON, not wrongful
        if (deliberateUsers.has(b.user_id)) continue;
        const freshDays = frozenDays.filter((d) => !remediatedPairs.has(`${b.user_id}|${d}`));
        if (!freshDays.length) continue;
        const a = affected.get(b.user_id) ?? { name: u?.name ?? null, slack: u?.slack_id ?? null, freezesNow: u?.streak_freezes_remaining ?? 0, wrongfulDays: [] };
        a.wrongfulDays.push(...freshDays);
        affected.set(b.user_id, a);
      }
      let refundable = 0;
      const usersOut = [...affected.entries()]
        .map(([uid, a]) => {
          const give = Math.min(a.wrongfulDays.length, Math.max(0, 5 - a.freezesNow)); // 5 is the max banked freezes
          refundable += give;
          return { user_id: uid, name: a.name, slack_id: a.slack, freezes_now: a.freezesNow, wrongful_days: [...new Set(a.wrongfulDays)].sort(), refundable_after_cap: give };
        })
        .sort((x, y) => y.wrongful_days.length - x.wrongful_days.length);
      return { note: "READ-ONLY detector. Heal via the deployed opted-out refund path.", since, affected_users: usersOut.length, refundable_after_cap: refundable, users: usersOut };
    },
  },
  {
    spec: {
      name: "get_zerostreak_sideproject_freeze_cohort",
      description:
        "Read-only detector for the 0-streak side-project freeze-burn regression (Sabio 2026-06-16): replays the FIXED work-availability rule and reports streak_days that SHOULD be review_protected (frozen day = refund owed, missed = streak broke, pending = stranded). Splits the regression cohort (day >= 2026-06-15) from the older open-review-gap cohort, and open (cron-healable) vs closed (backfill-only).",
      inputSchema: {
        type: "object",
        properties: {
          lookbackDays: { type: "number", description: "Window in days (default 60, max 120)." },
          limit: { type: "number", description: "Max candidate users to scan (default 100, max 500)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const lookback = clampLimit(args.lookbackDays, 60, 120);
      const REGRESSION_FLOOR = "2026-06-15";
      const startScan = shiftDayStr(new Date().toISOString().slice(0, 10), -lookback);
      const candidates = await db
        .selectDistinct({ user_id: streakDaysTable.user_id })
        .from(streakDaysTable)
        .where(
          and(
            sql`${streakDaysTable.status} IN ('pending','missed','frozen')`,
            sql`${streakDaysTable.day} >= ${startScan}`,
            sql`EXISTS (SELECT 1 FROM ships s WHERE s.user_id = ${streakDaysTable.user_id} AND s.status IN ('under_review','pending_fraud_review','pending_second_pass','needs_changes'))`,
          ),
        )
        .limit(clampLimit(args.limit, 100, 500));
      const affectedUsers: Array<{
        user_id: string;
        name: string | null;
        frozen: string[];
        missed: string[];
        pending: string[];
        closed_only_days: string[];
        regression_days: { frozen: string[]; missed: string[]; pending: string[] };
      }> = [];
      let totalFrozen = 0;
      let totalMissed = 0;
      let totalPending = 0;
      for (const { user_id: userId } of candidates) {
        const [u] = await db.select({ name: users.name, timezone: users.timezone }).from(users).where(eq(users.id, userId)).limit(1);
        if (!u) continue;
        const tz = u.timezone ?? "UTC";
        const today = streakDayKey(new Date(), tz);
        const yesterday = yesterdayStr(today);
        const startDay = shiftDayStr(today, -lookback);
        const projRows = await db
          .select({
            id: projectTable.id,
            created_at: projectTable.created_at,
            project_streak_days: projectTable.project_streak_days,
            is_team: sql<boolean>`(EXISTS (SELECT 1 FROM project_collaborators pc WHERE pc.project_id = ${projectTable.id} AND pc.status = 'active') AND coalesce(array_length(${projectTable.hackatime_projects}, 1), 0) > 0)`,
          })
          .from(projectTable)
          .where(eq(projectTable.user_id, userId));
        const shipRows = await db
          .select({ project_id: shipTable.project_id, queue_entered_at: shipTable.queue_entered_at, created_at: shipTable.created_at, reviewed_at: shipTable.reviewed_at })
          .from(shipTable)
          .where(and(eq(shipTable.user_id, userId), sql`${shipTable.status} IN ('under_review','pending_fraud_review','pending_second_pass','needs_changes')`));
        if (!shipRows.length) continue;
        const shipsByProject = new Map<number, typeof shipRows>();
        for (const s of shipRows) {
          const arr = shipsByProject.get(s.project_id);
          if (arr) arr.push(s);
          else shipsByProject.set(s.project_id, [s]);
        }
        const buildProjects = (openOnly: boolean) =>
          projRows.map((p) => ({
            createdAt: p.created_at,
            isTeam: !!p.is_team,
            projectStreakDays: p.project_streak_days ?? 0,
            ships: (shipsByProject.get(p.id) ?? []).filter((s) => (openOnly ? s.reviewed_at === null : true)),
          }));
        const newProtected = computeWorkAvailableReviewProtectedDays({ projects: buildProjects(false), tz, startDay, endDay: yesterday });
        if (newProtected.size === 0) continue;
        const oldProtected = computeWorkAvailableReviewProtectedDays({
          projects: buildProjects(false).map((p) => ({ ...p, projectStreakDays: 1 })),
          tz,
          startDay,
          endDay: yesterday,
        });
        const fixDelta = [...newProtected].filter((d) => !oldProtected.has(d));
        if (!fixDelta.length) continue;
        const newProtectedOpen = computeWorkAvailableReviewProtectedDays({ projects: buildProjects(true), tz, startDay, endDay: yesterday });
        const rows = await db
          .select({ day: streakDaysTable.day, status: streakDaysTable.status })
          .from(streakDaysTable)
          .where(and(eq(streakDaysTable.user_id, userId), inArray(streakDaysTable.day, fixDelta), sql`${streakDaysTable.status} IN ('pending','missed','frozen')`));
        if (!rows.length) continue;
        const statusByDay = new Map<string, string>(rows.map((r) => [r.day, r.status as string]));
        const plan = planReviewProtectionBackfill({ protectedDays: fixDelta, statusByDay });
        if (!plan.length) continue;
        const frozen = plan.filter((p) => p.from === "frozen").map((p) => p.day);
        const missed = plan.filter((p) => p.from === "missed").map((p) => p.day);
        const pending = plan.filter((p) => p.from === "pending").map((p) => p.day);
        totalFrozen += frozen.length;
        totalMissed += missed.length;
        totalPending += pending.length;
        const inReg = (d: string) => d >= REGRESSION_FLOOR;
        affectedUsers.push({
          user_id: userId,
          name: u.name,
          frozen,
          missed,
          pending,
          closed_only_days: plan.filter((p) => !newProtectedOpen.has(p.day)).map((p) => p.day),
          regression_days: { frozen: frozen.filter(inReg), missed: missed.filter(inReg), pending: pending.filter(inReg) },
        });
      }
      affectedUsers.sort((x, y) => y.frozen.length - x.frozen.length);
      return {
        note: "READ-ONLY detector. Heal via the deployed review-protection backfill / refund path.",
        regression_floor: REGRESSION_FLOOR,
        candidates_scanned: candidates.length,
        users_affected: affectedUsers.length,
        totals: { frozen: totalFrozen, missed: totalMissed, pending: totalPending },
        users: affectedUsers,
      };
    },
  },

  {
    spec: {
      name: "list_shop_items",
      description: "Shop catalog items with gold/fruit pricing, kind, and availability.",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", description: "Max rows (default 25, max 100)." } },
        additionalProperties: false,
      },
    },
    handler: async (args) =>
      db
        .select({
          id: shopItemTable.id,
          slug: shopItemTable.slug,
          name: shopItemTable.name,
          price_hours: shopItemTable.price_hours,
          price_fruit_amount: shopItemTable.price_fruit_amount,
          kind: shopItemTable.kind,
          available: shopItemTable.available,
          grant_amount_cents: shopItemTable.grant_amount_cents,
        })
        .from(shopItemTable)
        .orderBy(desc(shopItemTable.id))
        .limit(clampLimit(args.limit)),
  },
  {
    spec: {
      name: "get_order",
      description:
        "One shop order with its frozen item snapshot, selected modifiers, status, region, and buyer. PII (shipping address, phone, encrypted address) is deliberately NOT returned.",
      inputSchema: {
        type: "object",
        properties: { orderId: { type: "number", description: "The order id." } },
        required: ["orderId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = Number(args.orderId);
      if (!Number.isInteger(id)) throw new Error("orderId must be a number.");
      // explicit non-PII columns: never expose address/phone (fulfillment_note can carry an address)
      const [o] = await db
        .select({
          id: shopOrderTable.id,
          user_id: shopOrderTable.user_id,
          item_id: shopOrderTable.item_id,
          quantity: shopOrderTable.quantity,
          status: shopOrderTable.status,
          item_snapshot: shopOrderTable.item_snapshot,
          selected_modifiers: shopOrderTable.selected_modifiers,
          tracking_number: shopOrderTable.tracking_number,
          external_reference: shopOrderTable.external_reference,
          fulfillment_error: shopOrderTable.fulfillment_error,
          region: shopOrderTable.region,
          created_at: shopOrderTable.created_at,
          updated_at: shopOrderTable.updated_at,
        })
        .from(shopOrderTable)
        .where(eq(shopOrderTable.id, id))
        .limit(1);
      if (!o) throw new Error(`No order with id ${id}.`);
      const [buyer] = await db.select(USER_FIELDS).from(users).where(eq(users.id, o.user_id)).limit(1);
      return { order: o, buyer: buyer ?? null };
    },
  },
  {
    spec: {
      name: "list_orders",
      description:
        "Shop orders, optionally filtered by status (e.g. pending_internal_fulfillment, fulfilled, cancelled) and/or buyer. Newest first.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Exact order status." },
          userId: { type: "string", description: "Only this buyer's orders." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const status = str(args.status);
      const userId = str(args.userId);
      const conds = [];
      if (status) conds.push(eq(shopOrderTable.status, status as typeof shopOrderTable.status.enumValues[number]));
      if (userId) conds.push(eq(shopOrderTable.user_id, userId));
      return db
        .select({
          id: shopOrderTable.id,
          user_id: shopOrderTable.user_id,
          item_id: shopOrderTable.item_id,
          quantity: shopOrderTable.quantity,
          status: shopOrderTable.status,
          region: shopOrderTable.region,
          created_at: shopOrderTable.created_at,
        })
        .from(shopOrderTable)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(shopOrderTable.id))
        .limit(clampLimit(args.limit));
    },
  },
  {
    spec: {
      name: "get_currency_balance",
      description:
        "A user's spendable gold balance plus a count of locked (pending) fruit rows awaiting a build-complete ship.",
      inputSchema: {
        type: "object",
        properties: { userId: { type: "string", description: "The user's id." } },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      const [pending] = await db
        .select({ n: sql<number>`count(*)` })
        .from(currencyTransactionTable)
        .where(
          and(
            eq(currencyTransactionTable.user_id, id),
            isNull(currencyTransactionTable.unlocked_at),
          ),
        );
      return {
        user_id: id,
        gold_balance: await goldBalance(id),
        pending_locked_rows: Number(pending?.n ?? 0),
      };
    },
  },
  {
    spec: {
      name: "list_transactions",
      description: "A user's currency ledger rows (gold and fruit), newest first.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "The user's id." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      return db
        .select({
          id: currencyTransactionTable.id,
          amount: currencyTransactionTable.amount,
          type: currencyTransactionTable.type,
          source: currencyTransactionTable.source,
          fruit_type: currencyTransactionTable.fruit_type,
          memo: currencyTransactionTable.memo,
          counts: currencyTransactionTable.counts,
          unlocked_at: currencyTransactionTable.unlocked_at,
          created_at: currencyTransactionTable.created_at,
        })
        .from(currencyTransactionTable)
        .where(eq(currencyTransactionTable.user_id, id))
        .orderBy(desc(currencyTransactionTable.id))
        .limit(clampLimit(args.limit));
    },
  },

  {
    spec: {
      name: "get_ticket",
      description: "A support ticket with its full message thread (oldest first).",
      inputSchema: {
        type: "object",
        properties: { ticketId: { type: "number", description: "The ticket id." } },
        required: ["ticketId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = Number(args.ticketId);
      if (!Number.isInteger(id)) throw new Error("ticketId must be a number.");
      const [t] = await db.select().from(supportTicketTable).where(eq(supportTicketTable.id, id)).limit(1);
      if (!t) throw new Error(`No ticket with id ${id}.`);
      return {
        ticket: t,
        messages: await db
          .select({
            id: supportTicketMessageTable.id,
            author_user_id: supportTicketMessageTable.author_user_id,
            author_kind: supportTicketMessageTable.author_kind,
            body: supportTicketMessageTable.body,
            is_internal_note: supportTicketMessageTable.is_internal_note,
            created_at: supportTicketMessageTable.created_at,
            deleted_at: supportTicketMessageTable.deleted_at,
          })
          .from(supportTicketMessageTable)
          .where(eq(supportTicketMessageTable.ticket_id, id))
          .orderBy(supportTicketMessageTable.id),
      };
    },
  },
  {
    spec: {
      name: "list_tickets",
      description:
        "Support tickets, optionally filtered by status (open, claimed, resolved). Newest first.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Exact ticket status." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const status = str(args.status);
      return db
        .select({
          id: supportTicketTable.id,
          user_id: supportTicketTable.user_id,
          subject: supportTicketTable.subject,
          category: supportTicketTable.category,
          priority: supportTicketTable.priority,
          status: supportTicketTable.status,
          claimed_by_user_id: supportTicketTable.claimed_by_user_id,
          created_at: supportTicketTable.created_at,
        })
        .from(supportTicketTable)
        .where(status ? eq(supportTicketTable.status, status as typeof supportTicketTable.status.enumValues[number]) : undefined)
        .orderBy(desc(supportTicketTable.id))
        .limit(clampLimit(args.limit));
    },
  },
  {
    spec: {
      name: "list_audit_logs",
      description:
        "Append-only audit log rows, filterable by entity_type, entity_id, actor id, and/or action. Newest first.",
      inputSchema: {
        type: "object",
        properties: {
          entityType: { type: "string", description: "e.g. user, ship, project, support_ticket, mcp_token." },
          entityId: { type: "string", description: "The entity id (string)." },
          actorId: { type: "string", description: "The acting user's id." },
          action: { type: "string", description: "e.g. adjust_user_gold, update_user_roles." },
          limit: { type: "number", description: "Max rows (default 25, max 100)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const conds = [];
      const entityType = str(args.entityType);
      const entityId = str(args.entityId);
      const actorId = str(args.actorId);
      const action = str(args.action);
      if (entityType) conds.push(eq(auditLogTable.entity_type, entityType));
      if (entityId) conds.push(eq(auditLogTable.entity_id, entityId));
      if (actorId) conds.push(eq(auditLogTable.actor_id, actorId));
      if (action) conds.push(eq(auditLogTable.action, action));
      return db
        .select({
          id: auditLogTable.id,
          actor_id: auditLogTable.actor_id,
          action: auditLogTable.action,
          entity_type: auditLogTable.entity_type,
          entity_id: auditLogTable.entity_id,
          change_summary: auditLogTable.change_summary,
          public_message: auditLogTable.public_message,
          created_at: auditLogTable.created_at,
        })
        .from(auditLogTable)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(auditLogTable.id))
        .limit(clampLimit(args.limit));
    },
  },

  {
    spec: {
      name: "list_fines",
      description:
        "List fine records from the Unified YSWS Airtable fines table (base app3A5kJwYqxMLOgh / table tblKzxJawDsetINVp), read via the unified token. Returns each record's id + all raw fields, plus a best-effort `resolved` block per row (maker, source, and the Macondo user/projects/ships) built by walking the fine's spotcheck -> approved_projects -> Code URL/Email bridge. Pass resolve:false to skip that enrichment (raw + faster). Optionally pass an Airtable filterByFormula to narrow.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max records (default 25, max 100)." },
          filterByFormula: { type: "string", description: "Optional Airtable filterByFormula, e.g. \"{Status}='open'\"." },
          resolve: { type: "boolean", description: "Resolve each fine to its Macondo maker/project/ship (default true). Set false for raw fine rows only (faster; no Airtable/DB bridge lookups)." },
        },
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const records = await fetchFines({
        maxRecords: clampLimit(args.limit),
        filterByFormula: str(args.filterByFormula) ?? undefined,
      });
      const resolve = args.resolve !== false; // default on
      const fines = resolve
        ? await mapPool(records, 6, async (r) => { // resolve 6 fines at a time
            let resolved: FineMacondoResolution | null = null;
            try {
              const ar = await resolveFineToUnifiedProject(r.fields);
              if (ar) resolved = await resolveFineToMacondo(ar);
            } catch {
              // a single unresolvable fine must not fail the list
              resolved = null;
            }
            return { id: r.id, fields: r.fields, resolved };
          })
        : records.map((r) => ({
            id: r.id,
            fields: r.fields,
            resolved: null as FineMacondoResolution | null,
          }));
      return { count: fines.length, resolved: resolve, fines };
    },
  },
  {
    spec: {
      name: "get_fine",
      description:
        "Fetch one fine record by its Airtable record id and resolve the Macondo project/ship it concerns. Bridge: the fine's `project` id is NOT ships.airtable_record_id (different Airtable base); instead it walks fine -> YSWS-Spotchecks -> approved_projects -> Code URL/Email -> Macondo user/project/ship. Returns the fine fields, a `resolved` block (source LeafdBot/drydock-sonar, maker, and every project + ship sharing the fined Code URL), and a legacy airtable_record_id match for older fines. Chain get_ship_reward(shipId) then ship_reject or ship_revert_approval.",
      inputSchema: {
        type: "object",
        properties: { recordId: { type: "string", description: "The fine's Airtable record id (rec…)." } },
        required: ["recordId"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const recordId = str(args.recordId);
      if (!recordId) throw new Error("recordId is required.");
      const fine = await fetchFineById(recordId);
      if (!fine) throw new Error(`No fine record ${recordId}.`);

      // fine -> spotcheck -> approved_projects -> Code URL/Email -> Macondo
      let resolved: FineMacondoResolution | null = null;
      const airtableResolution = await resolveFineToUnifiedProject(fine.fields);
      if (airtableResolution) {
        resolved = await resolveFineToMacondo(airtableResolution);
      }

      // pre-spotcheck fines embed a Macondo ships.airtable_record_id directly
      const macondoRec = extractMacondoRecordId(fine.fields);
      let legacyShip: { id: number; status: string; user_id: string } | null = null;
      if (macondoRec) {
        const [s] = await db
          .select({ id: shipTable.id, status: shipTable.status, user_id: shipTable.user_id })
          .from(shipTable)
          .where(eq(shipTable.airtable_record_id, macondoRec))
          .limit(1);
        legacyShip = s ?? null;
      }

      const shipIds =
        resolved?.projects.flatMap((p) => p.ships.map((s) => s.id)) ?? [];
      const next = shipIds.length
        ? `Resolved to ship(s) ${shipIds.join(", ")}. Use get_ship_reward(shipId), then ship_reject / ship_revert_approval to act.`
        : legacyShip
          ? `Resolved via legacy airtable_record_id to ship ${legacyShip.id}. Use get_ship_reward(${legacyShip.id}), then act.`
          : "Could not resolve a Macondo ship (no spotcheck link, or the maker resubmitted so the Code URL no longer maps to a project). Act manually.";

      return {
        fine: { id: fine.id, fields: fine.fields },
        resolved,
        legacy_ship: legacyShip,
        macondo_record_id: macondoRec,
        next,
      };
    },
  },
  {
    spec: {
      name: "preview_deflate_ship_hours",
      description:
        "PREVIEW ONLY (no writes): compute what deflating a ship's approved hours would do to its reward. Reuses the real reward math (level rate x FROZEN original multiplier), verifies the original multiplier against the gold actually paid, and reports the corrected gold/fruit, the exact ledger ops that an apply would perform, and whether the owner's balance would go negative. Apply via the deflate script after reviewing.",
      inputSchema: {
        type: "object",
        properties: {
          shipId: { type: "number", description: "The ship id." },
          newTotalHours: { type: "number", description: "Proposed new total approved hours (override_hours)." },
        },
        required: ["shipId", "newTotalHours"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const id = Number(args.shipId);
      const newHours = Number(args.newTotalHours);
      if (!Number.isInteger(id)) throw new Error("shipId must be a number.");
      if (!Number.isFinite(newHours) || newHours < 0) throw new Error("newTotalHours must be >= 0.");
      const [s] = await db.select().from(shipTable).where(eq(shipTable.id, id)).limit(1);
      if (!s) throw new Error(`No ship ${id}.`);
      const [project] = await db
        .select({ level: projectTable.level, type: projectTable.type })
        .from(projectTable)
        .where(eq(projectTable.id, s.project_id))
        .limit(1);
      const level = parseLevel(project?.level ?? null);
      if (!level) throw new Error(`Project has no parseable level (${project?.level ?? "null"}).`);
      const rewardRows = await db
        .select({ id: currencyTransactionTable.id, amount: currencyTransactionTable.amount, memo: currencyTransactionTable.memo })
        .from(currencyTransactionTable)
        .where(
          and(
            eq(currencyTransactionTable.ship_id, id),
            eq(currencyTransactionTable.source, "ship_reward"),
            eq(currencyTransactionTable.counts, true),
            isNull(currencyTransactionTable.fruit_type),
          ),
        );
      const paidGold = rewardRows.reduce((a, r) => a + Number(r.amount), 0);
      const oldHours = Number(s.override_hours ?? 0);
      const mult = Number(s.second_pass_multiplier ?? 0) || null;
      const verifyGold = mult != null ? Math.floor(computeGoldReward(oldHours, level) * mult) : null;
      const multVerified = mult != null && verifyGold === paidGold;
      const newGold = mult != null ? Math.floor(computeGoldReward(newHours, level) * mult) : null;
      const newFruitDelta = mult != null ? Math.floor(computeFruitReward(newHours, level) * mult) : null;
      const goldDelta = newGold != null ? newGold - paidGold : null;
      const ownerGold = await goldBalance(s.user_id);
      const ownerGoldAfter = goldDelta != null ? ownerGold + goldDelta : null;
      return {
        note: "PREVIEW ONLY — no writes performed. Apply via scripts/deflate-ship-*.ts after operator preflight.",
        ship: {
          id: s.id,
          status: s.status,
          user_id: s.user_id,
          override_hours: oldHours,
          software_override_hours: s.software_override_hours,
          second_pass_multiplier: mult,
          airtable_record_id: s.airtable_record_id,
        },
        project_level: level,
        gold_rate_per_hour: levelConfig[level].goldPerHour,
        fruit_n_per_hour: levelConfig[level].nPerHour,
        current_paid_gold: paidGold,
        multiplier_verified: multVerified,
        multiplier_verify_expected_gold: verifyGold,
        proposed: { new_total_hours: newHours, new_gold: newGold, new_lifetime_fruit_delta: newFruitDelta, gold_delta: goldDelta },
        owner_gold_before: ownerGold,
        owner_gold_after: ownerGoldAfter,
        would_go_negative: ownerGoldAfter != null && ownerGoldAfter < 0,
        ledger_ops_that_would_apply: [
          ...rewardRows.map((r) => ({ op: "disable", tx_id: r.id, was_amount: Number(r.amount) })),
          ...(newGold != null ? [{ op: "insert_ship_reward", new_amount: newGold }] : []),
        ],
        airtable_action: s.airtable_record_id
          ? `PATCH unified record ${s.airtable_record_id} 'Optional - Override Hours Spent' = ${newHours} (set ship.override_reason to skip cross-YSWS dedup).`
          : "no airtable_record_id; nothing to PATCH.",
        warnings: [
          multVerified ? null : "Original multiplier could NOT be verified against the paid gold; handle manually.",
          ownerGoldAfter != null && ownerGoldAfter < 0
            ? "Owner balance would go negative; return the HCB grant first (auto-refunds gold) before applying."
            : null,
          rewardRows.length !== 1
            ? `Found ${rewardRows.length} active ship_reward rows (expected 1); contributor split or anomaly, handle manually.`
            : null,
          s.status !== "shipped" && s.status !== "shipped_missing_airtable"
            ? `Ship status is ${s.status}; deflation targets paid (shipped) ships.`
            : null,
        ].filter(Boolean),
      };
    },
  },
  {
    spec: {
      name: "preview_cap_project_level",
      description:
        "PREVIEW ONLY (no writes): compute what capping a project to a new level would do. Shows the new fruit name and per-hour rates, and for every shipped ship recomputes the corrected gold at the new level x its FROZEN multiplier vs what was paid. Macondo's Airtable stores only hours, so a level cap needs no Airtable change. Apply via the cap-level script after reviewing.",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "number", description: "The project id." },
          newLevel: { type: "number", description: "Proposed new level (1-4)." },
        },
        required: ["projectId", "newLevel"],
        additionalProperties: false,
      },
    },
    handler: async (args) => {
      const pid = Number(args.projectId);
      if (!Number.isInteger(pid)) throw new Error("projectId must be a number.");
      const newLevel = parseLevel(String(Number(args.newLevel)));
      if (!newLevel) throw new Error("newLevel must be 1-4.");
      const [p] = await db
        .select({ id: projectTable.id, name: projectTable.name, level: projectTable.level, type: projectTable.type, fruit: projectTable.fruit })
        .from(projectTable)
        .where(eq(projectTable.id, pid))
        .limit(1);
      if (!p) throw new Error(`No project ${pid}.`);
      const newFruit =
        getFruitsByLevelAndCategory(newLevel, p.type as ProjectCategory)[0]?.name ?? null;
      const ships = await db
        .select({ id: shipTable.id, status: shipTable.status, override_hours: shipTable.override_hours, second_pass_multiplier: shipTable.second_pass_multiplier })
        .from(shipTable)
        .where(and(eq(shipTable.project_id, pid), inArray(shipTable.status, ["shipped", "shipped_missing_airtable"])));
      const perShip = [];
      for (const sh of ships) {
        const rewardRows = await db
          .select({ amount: currencyTransactionTable.amount })
          .from(currencyTransactionTable)
          .where(
            and(
              eq(currencyTransactionTable.ship_id, sh.id),
              eq(currencyTransactionTable.source, "ship_reward"),
              eq(currencyTransactionTable.counts, true),
              isNull(currencyTransactionTable.fruit_type),
            ),
          );
        const paidGold = rewardRows.reduce((a, r) => a + Number(r.amount), 0);
        const mult = Number(sh.second_pass_multiplier ?? 0) || null;
        const hours = Number(sh.override_hours ?? 0);
        const newGold = mult != null ? Math.floor(computeGoldReward(hours, newLevel) * mult) : null;
        perShip.push({
          ship_id: sh.id,
          hours,
          multiplier: mult,
          current_paid_gold: paidGold,
          new_gold: newGold,
          gold_delta: newGold != null ? newGold - paidGold : null,
        });
      }
      return {
        note: "PREVIEW ONLY — no writes performed. Apply via scripts/cap-*-level*.ts after operator preflight.",
        project: { id: p.id, name: p.name, current_level: parseLevel(p.level), current_fruit: p.fruit, type: p.type },
        proposed: { new_level: newLevel, new_fruit: newFruit, new_gold_rate_per_hour: levelConfig[newLevel].goldPerHour, new_fruit_n_per_hour: levelConfig[newLevel].nPerHour },
        shipped_ships: perShip,
        airtable_action: "none — the Unified Airtable stores hours + justification only, not level or gold.",
      };
    },
  },

  {
    spec: {
      name: "adjust_user_gold",
      description:
        "Add or subtract spendable gold for a user. Writes one reversible admin_adjustment ledger row, audits it, and notifies the maker. A subtraction may not drive the balance negative.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "Target user id." },
          amount: { type: "number", description: "Positive whole number of gold." },
          direction: { type: "string", enum: ["add", "subtract"], description: "Add or subtract." },
          note: { type: "string", description: "Required note recorded in the audit trail and shown to the maker." },
        },
        required: ["userId", "amount", "direction", "note"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const userId = str(args.userId);
      if (!userId) throw new Error("userId is required.");
      return { ok: true, ...(await adjustUserGold({
        targetUserId: userId,
        amount: Number(args.amount),
        direction: args.direction as "add" | "subtract",
        note: str(args.note) ?? "",
        actorId: ctx.user.id,
        via: "mcp",
      })) };
    },
  },
  {
    spec: {
      name: "set_user_roles",
      description:
        "Replace a user's internal role set (the full desired array). Only a supaadmin token may grant or revoke the supaadmin role. Refuses to remove your own supaadmin role.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "Target user id." },
          roles: {
            type: "array",
            items: { type: "string" },
            description:
              "Full desired role set: supaadmin, admin, fraudster, software_reviewer, hardware_reviewer, fulfiller, hq, support, events.",
          },
        },
        required: ["userId", "roles"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const userId = str(args.userId);
      if (!userId) throw new Error("userId is required.");
      const roles = Array.isArray(args.roles) ? (args.roles as string[]) : null;
      if (!roles) throw new Error("roles must be an array.");
      if (userId === ctx.user.id && !roles.includes("supaadmin")) {
        throw new Error("Refusing to remove your own supaadmin role via MCP.");
      }
      return { ok: true, ...(await setUserRoles({
        actor: ctx.user,
        targetUserId: userId,
        roles,
        via: "mcp",
      })) };
    },
  },
  {
    spec: {
      name: "resolve_support_ticket",
      description:
        "Mark an open or claimed support ticket as resolved. Audits the change and fans out the same Slack + notification side effects as the internal UI.",
      inputSchema: {
        type: "object",
        properties: { ticketId: { type: "number", description: "The ticket id." } },
        required: ["ticketId"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const id = Number(args.ticketId);
      if (!Number.isInteger(id)) throw new Error("ticketId must be a number.");
      const updated = await markTicketResolved({ ticketId: id, resolvedByUserId: ctx.user.id });
      if (!updated) {
        throw new Error("Ticket cannot be resolved in its current state.");
      }
      try {
        await writeAudit({
          actor_id: ctx.user.id,
          action: "support_ticket.resolved",
          entity_type: "support_ticket",
          entity_id: String(updated.id),
          old_value: null,
          new_value: { status: "resolved", resolved_by_user_id: ctx.user.id, via: "mcp" },
          sensitive: false,
          public_message: `Ticket #${updated.id} resolved`,
          change_summary: updated.subject,
        });
      } catch (err) {
        console.error("[mcp] audit resolve failed", err);
      }
      await fanOutResolveSideEffects(updated, {
        resolvedByName: ctx.user.name ?? ctx.user.email,
        resolvedByUserId: ctx.user.id,
        publicThreadText:
          ":white_check_mark: This ticket has been marked resolved. If you still need help, reply here within 7 days to reopen it.",
        notifyBody:
          "Your support ticket has been marked resolved. Rate the response or reply if you still need help.",
      });
      return { ok: true, id: updated.id, status: updated.status };
    },
  },
  {
    spec: {
      name: "requalify_pending_streak_days",
      description:
        "Qualify-up sweep: flips a user's `pending` streak_days to qualified where journal + hackatime seconds now meet the one-hour threshold (e.g. after a cross-day journal edit or a late hackatime sync). Safe and increase-only; never demotes a day.",
      inputSchema: {
        type: "object",
        properties: { userId: { type: "string", description: "The user's id." } },
        required: ["userId"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      const [u] = await db
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!u) throw new Error(`No user with id "${id}".`);
      const result = await requalifyPendingStreakDaysForUser(id, u.timezone);
      if (result.requalified.length) {
        try {
          await writeAudit({
            actor_id: ctx.user.id,
            action: "mcp_requalify_streak_days",
            entity_type: "user",
            entity_id: id,
            old_value: null,
            new_value: { requalified: result.requalified, via: "mcp" },
            sensitive: true,
            public_message: `Requalified ${result.requalified.length} pending streak day(s)`,
            change_summary: result.requalified.join(", "),
          });
        } catch (err) {
          console.error("[mcp] audit requalify failed", err);
        }
      }
      return { ok: true, ...result };
    },
  },
  {
    spec: {
      name: "refund_streak_freeze",
      description:
        "Refund a streak freeze that was burned on a day which actually met the one-hour threshold. Flips that `frozen` streak_days row back to `active`, returns the freeze to the wallet, and recomputes per-project streaks. Only frozen days that genuinely qualified can be refunded.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "The user's id." },
          day: { type: "string", description: "The day to refund, YYYY-MM-DD." },
          reason: { type: "string", description: "Audit reason (min 3 chars)." },
        },
        required: ["userId", "day", "reason"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      return refundStreakFreeze({
        userId: id,
        day: str(args.day) ?? "",
        reason: str(args.reason) ?? "",
        actorId: ctx.user.id,
        via: "mcp",
      });
    },
  },
  {
    spec: {
      name: "heal_streak_day",
      description:
        "Goodwill heal of one lapsed streak day: protects it as `frozen` (bridges and counts), backs it with a NET-ZERO freeze comp (grant one, consume it for the day, balance unchanged), and restores any project streaks an all_streaks_reset zeroed on that day. Idempotent and clobber-guarded; refuses today/future days and leaves already-qualified or review-protected days untouched. Does not touch last_active_date.",
      inputSchema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "The user's id." },
          day: { type: "string", description: "The day to heal, YYYY-MM-DD (must be before the user's local today)." },
          reason: { type: "string", description: "Optional audit reason." },
        },
        required: ["userId", "day"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const id = str(args.userId);
      if (!id) throw new Error("userId is required.");
      return healStreakDay({
        userId: id,
        day: str(args.day) ?? "",
        actorId: ctx.user.id,
        reason: str(args.reason) ?? undefined,
      });
    },
  },
  {
    spec: {
      name: "ship_reject",
      description:
        "Terminally reject a ship (valid only from under_review / pending_fraud_review / pending_second_pass). This BLOCKS the project from ever resubmitting; the only undo is ship_reverse_decision or ship_revert_approval. Moves no money on its own, so only use it on a ship that never paid out. Requires audit notes.",
      inputSchema: {
        type: "object",
        properties: {
          shipId: { type: "number", description: "The ship id." },
          auditNotes: { type: "string", description: "Internal reason for the rejection (required)." },
          userMessage: { type: "string", description: "Student-facing rejection message (optional; a generic notice is used if omitted)." },
        },
        required: ["shipId", "auditNotes"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const id = Number(args.shipId);
      if (!Number.isInteger(id)) throw new Error("shipId must be a number.");
      const auditNotes = str(args.auditNotes);
      if (!auditNotes) throw new Error("auditNotes is required for a rejection.");
      const [ship] = await db.select().from(shipTable).where(eq(shipTable.id, id)).limit(1);
      if (!ship) throw new Error(`No ship with id ${id}.`);
      const [project] = await db
        .select({ name: projectTable.name })
        .from(projectTable)
        .where(eq(projectTable.id, ship.project_id))
        .limit(1);
      const res = await markShipRejected({
        shipId: id,
        shipBefore: ship,
        projectId: ship.project_id,
        projectName: project?.name ?? "",
        notifyUserId: ship.user_id,
        actorId: ctx.user.id,
        auditNotes,
        userMessage: str(args.userMessage) ?? null,
        decisionAttachments: null,
        slackAttribution: " (via admin)",
        source: "reviewer",
      });
      if (!res.ok) {
        throw new Error(
          res.reason === "not_found"
            ? `Ship ${id} not found.`
            : `Ship ${id} is not in a state that can be rejected (already reviewed, withdrawn, or raced).`,
        );
      }
      return { ok: true, ship_id: id, status: "rejected" };
    },
  },
  {
    spec: {
      name: "ship_revert_approval",
      description:
        "Reverse an APPROVED (shipped) ship: the safe full unwind. Disables the ship_reward + review_reward gold, restores converted pending fruit, claws back post-approval spending until balances are non-negative, cancels any HCB card grants (HCB-first; fails if HCB refuses), and returns the ship to under_review, notifying the student. This is the correct way to claw back gold from a paid ship being fined. Only valid from shipped / shipped_missing_airtable.",
      inputSchema: {
        type: "object",
        properties: {
          shipId: { type: "number", description: "The ship id." },
          internalNotes: { type: "string", description: "Internal reasoning for the revert (required; audit + grant cancel reason)." },
          publicNotes: { type: "string", description: "Optional student-facing reason shown in the notification." },
        },
        required: ["shipId", "internalNotes"],
        additionalProperties: false,
      },
    },
    write: true,
    handler: async (args, ctx) => {
      requireWrite(ctx);
      const id = Number(args.shipId);
      if (!Number.isInteger(id)) throw new Error("shipId must be a number.");
      const internalNotes = str(args.internalNotes);
      if (!internalNotes) throw new Error("internalNotes is required.");
      const result = await revertShipApproval({
        shipId: id,
        actorId: ctx.user.id,
        internalNotes,
        publicNotes: str(args.publicNotes) ?? null,
      });
      return { ok: true, ship_id: id, status: result.ship.status, ...result };
    },
  },
];

export const TOOLS: Record<string, Tool> = Object.fromEntries(
  tools.map((t) => [t.spec.name, t]),
);

export function listToolSpecs(canWrite: boolean): ToolSpec[] {
  return tools.filter((t) => canWrite || !t.write).map((t) => t.spec);
}
