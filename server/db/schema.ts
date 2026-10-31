// tell santi on slack before editing the schema files

import {
  pgTable,
  serial,
  bigserial,
  text,
  timestamp,
  date,
  boolean,
  integer,
  varchar,
  jsonb,
  numeric,
  pgEnum,
  uniqueIndex,
  index,
  uuid,
  customType,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { AriInboundEvent } from "../types/ari";
import type { AutoCheckResult } from "../types/auto-checks";

// Drizzle has no pgvector type; postgres-js reads and writes vectors as `[1,2,3]` text.
// 1536 dims matches text-embedding-3-small from aiEmbed().
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

// Non-binding intent signal, not an RSVP: it gates nothing and grants nothing.
export const eventAttendanceIntent = pgEnum("event_attendance_intent", [
  "yes",
  "no",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),

  sub: varchar("sub"),
  slack_id: varchar("slack_id"),
  username: varchar("username"),
  // Last refresh of username + avatar from the Slack handle; drives the refresh-username cron.
  username_synced_at: timestamp("username_synced_at"),
  hackatime_id: integer("hackatime_id"),
  hcb_email: text("hcb_email"),
  locale: varchar("locale").default("en"),
  timezone: varchar("timezone").default("UTC"),
  // Hackatime-reported IANA tz; when set it is authoritative and written through to `timezone`.
  // Null means browser detection still owns `timezone`.
  hackatime_timezone: varchar("hackatime_timezone"),
  // From the confirmed shipping address; beats region_override and IP geolocation for shop pricing.
  country: varchar("country", { length: 2 }),
  // Shop dropdown override, only used when no shipping country is on file.
  region_override: varchar("region_override", { length: 2 }),
  roles: text("roles").array(),

  // Hidden from explore feeds and leaderboards. Set on non-human actor rows
  // (server/lib/system-actors.ts) and staff test accounts; safe on a live account.
  is_system: boolean("is_system").notNull().default(false),

  is_temp: boolean("is_temp").default(false), // true for email-only signups before HCA link
  onboarding_step: varchar("onboarding_step").default("welcome"),
  onboarding_data: text("onboarding_data"), // JSON blob for checklist state, experience level, etc.

  completed_guides: text("completed_guides").array(), // e.g. ["html"]

  github_token: text("github_token"),
  // Signin checks the OAuth-returned GitHub id against this so only the originally linked account matches.
  github_id: integer("github_id"),
  hackatime_oauth_token: text("hackatime_oauth_token"),
  // 'ok' | 'invalid_token' (revoked; re-linking fixes it) | 'api_restricted' (re-linking does NOT help).
  // Hackatime issues no refresh tokens, so a 401 is terminal; non-'ok' users are skipped by hackatime sweeps.
  hackatime_api_status: text("hackatime_api_status").notNull().default("ok"),
  hackatime_api_status_changed_at: timestamp("hackatime_api_status_changed_at"),

  last_seen_at: timestamp("last_seen_at").defaultNow(),
  last_login_at: timestamp("last_login_at").defaultNow(),

  // Snapshot from the last OAuth callback so gates don't hit auth.hackclub.com on every page load.
  // Rejected users never reach a session, so an active session should never see "ineligible".
  hca_verification_status: text("hca_verification_status"),
  hca_ysws_eligible: boolean("hca_ysws_eligible"),
  // Server-only: never include in /api/auth/me or any client payload.
  // HCA may rotate it on refresh, so syncHcaIdentity overwrites it.
  hca_refresh_token: text("hca_refresh_token"),
  // Drives the per-user syncHcaIdentity cooldown and the resync cron's stalest-first order.
  hca_last_sync_at: timestamp("hca_last_sync_at"),

  // Latest day worked on ANY project; the floor for the daily reconcile gap walk.
  last_active_date: varchar("last_active_date", { length: 10 }), // "YYYY-MM-DD" UTC; matches streak_days.day
  streak_freezes_remaining: integer("streak_freezes_remaining").notNull().default(5), // starting freeze allowance
  // When false, a gap day resets every project streak even with freezes in the bank.
  auto_use_streak_freezes: boolean("auto_use_streak_freezes").notNull().default(true),
  // LEGACY: read-only since the UTC re-anchor; new code reads reminder_hours_before_day_end.
  preferred_reminder_hour: integer("preferred_reminder_hour").notNull().default(20), // 8pm
  // Hours before local midnight that the reminder DM fires (local hour 24 - N in users.timezone).
  reminder_hours_before_day_end: integer("reminder_hours_before_day_end").notNull().default(4),
  // Local hours (1..23) the reminder DM may fire; null falls back to reminder_hours_before_day_end.
  reminder_local_hours: integer("reminder_local_hours").array(),
  streak_slack_notifications: boolean("streak_slack_notifications").notNull().default(true),

  // Seconds drive delta math, since comparing rounded hours swallowed partial-hour activity.
  // Null seconds marks the first sync after backfill, which is treated as a no-op.
  last_hackatime_total_hours: numeric("last_hackatime_total_hours", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  last_hackatime_total_seconds: integer("last_hackatime_total_seconds"),
  last_hackatime_synced_at: timestamp("last_hackatime_synced_at"),

  // Stamped before the #macondo auto-invite call so a failed invite doesn't retry every signin
  // and a user who leaves the channel isn't re-added.
  slack_macondo_auto_invited_at: timestamp("slack_macondo_auto_invited_at"),

  // When the user spent their one post-deadline grace submission; null = still available.
  // Stamped only after the ship row is written, so a failed submit doesn't burn it.
  post_deadline_ship_used_at: timestamp("post_deadline_ship_used_at"),

  // A referral only counts toward a reward tier once users.sub (HCA linkage) is set.
  referral_code: varchar("referral_code", { length: 8 }).unique(),
  referred_by_user_id: text("referred_by_user_id"),
  referred_at: timestamp("referred_at"),

  // Historical fruits earned per fruit name, kept since the gold-only migration.
  // Incremented on ship approval by floor(baseFruitReward x projectMultiplier).
  lifetime_fruits_earned: jsonb("lifetime_fruits_earned").$type<Record<string, number>>().notNull().default({}),

  // NULL keeps the popup coming back; dismissing with the X deliberately does NOT write here.
  event_attendance_intent: eventAttendanceIntent("event_attendance_intent"),
  event_attendance_intent_at: timestamp("event_attendance_intent_at"),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  // SHA-256 hex of the raw cookie token. Plaintext legacy rows are rejected.
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"), // kept for sessions table only

  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
});

export const signupEmailTable = pgTable("signup_emails", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  created_at: timestamp("created_at").defaultNow(),
});

// Written by server middleware on the initial HTML request so ad blockers can't filter it.
// Signin backfills a null user_id by matching visitor_cookie.
export const referralVisitsTable = pgTable(
  "referral_visits",
  {
    id: serial("id").primaryKey(),
    visitor_cookie: text("visitor_cookie").notNull(),
    user_id: text("user_id").references(() => users.id),
    utm_source: text("utm_source"),
    utm_medium: text("utm_medium"),
    utm_campaign: text("utm_campaign"),
    utm_term: text("utm_term"),
    utm_content: text("utm_content"),
    referer: text("referer"),
    referer_host: text("referer_host"),
    landing_path: text("landing_path").notNull(),
    user_agent: text("user_agent"),
    ip_address: text("ip_address"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("referral_visits_created_at_idx").on(t.created_at),
    visitorCookieIdx: index("referral_visits_visitor_cookie_idx").on(t.visitor_cookie),
    userIdIdx: index("referral_visits_user_id_idx").on(t.user_id),
    utmSourceIdx: index("referral_visits_utm_source_idx").on(t.utm_source),
    utmCampaignIdx: index("referral_visits_utm_campaign_idx").on(t.utm_campaign),
    refererHostIdx: index("referral_visits_referer_host_idx").on(t.referer_host),
  }),
);

// One row per pageview from the client beacon, including SPA navigations the referral middleware never sees.
// Sessions are derived in SQL at read time (30-minute inactivity gap); the raw IP is never stored.
export const analyticsPageviewsTable = pgTable(
  "analytics_pageviews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Reuses the macondo_rv visitor cookie so uniques line up with the referral tracker.
    visitor_id: text("visitor_id").notNull(),
    // Resolved from the session token at flush time, like referral capture.
    user_id: text("user_id").references(() => users.id),
    pathname: text("pathname").notNull(),
    referrer_host: text("referrer_host"),
    // utm_source, else the mapped referrer host, else "Direct / None" (see classifySource()).
    source: text("source"),
    utm_source: text("utm_source"),
    utm_medium: text("utm_medium"),
    utm_campaign: text("utm_campaign"),
    utm_term: text("utm_term"),
    utm_content: text("utm_content"),
    country: varchar("country", { length: 2 }),
    browser: text("browser"),
    os: text("os"),
    device_type: text("device_type"),
    screen_size: text("screen_size"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("analytics_pageviews_created_at_idx").on(t.created_at),
    // Drives sessionization (LAG over a visitor's events in time order).
    visitorCreatedIdx: index("analytics_pageviews_visitor_created_idx").on(
      t.visitor_id,
      t.created_at,
    ),
    pathnameIdx: index("analytics_pageviews_pathname_idx").on(t.pathname),
    sourceIdx: index("analytics_pageviews_source_idx").on(t.source),
    countryIdx: index("analytics_pageviews_country_idx").on(t.country),
    browserIdx: index("analytics_pageviews_browser_idx").on(t.browser),
    osIdx: index("analytics_pageviews_os_idx").on(t.os),
    utmSourceIdx: index("analytics_pageviews_utm_source_idx").on(t.utm_source),
    utmCampaignIdx: index("analytics_pageviews_utm_campaign_idx").on(
      t.utm_campaign,
    ),
  }),
);

// CTA click-throughs that pageviews can't see; joined to referralVisitsTable on visitor_cookie
// to rebuild the source -> landing -> guide funnel.
export const landingPageClicksTable = pgTable(
  "landing_page_clicks",
  {
    id: serial("id").primaryKey(),
    visitor_cookie: text("visitor_cookie"),
    user_id: text("user_id").references(() => users.id),
    landing: text("landing").notNull(),
    target: text("target").notNull(),
    locale: text("locale"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("landing_page_clicks_created_at_idx").on(t.created_at),
    landingIdx: index("landing_page_clicks_landing_idx").on(t.landing),
    visitorCookieIdx: index("landing_page_clicks_visitor_cookie_idx").on(
      t.visitor_cookie,
    ),
  }),
);

// Full history of Loops events mirrored to Airtable, which keeps only the latest timestamp per event.
// user_email is the Airtable join key that backfills scan by.
export const loopsEventLogs = pgTable(
  "loops_event_logs",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id").references(() => users.id),
    user_email: text("user_email").notNull(),
    event: text("event").notNull(),
    occurred_at: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("loops_event_logs_user_email_idx").on(t.user_email),
    occurredAtIdx: index("loops_event_logs_occurred_at_idx").on(t.occurred_at),
    userIdIdx: index("loops_event_logs_user_id_idx").on(t.user_id),
  }),
);

export const internalOAuthConnectionTable = pgTable("internal_oauth_connections", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  access_token: text("access_token").notNull(),
  refresh_token: text("refresh_token"),
  token_type: text("token_type"),
  scope: text("scope"),
  expires_at: timestamp("expires_at"),
  connected_by_user_id: text("connected_by_user_id").references(() => users.id),
  external_user_id: text("external_user_id"),
  external_user_email: text("external_user_email"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const piiLockerTable = pgTable("pii_locker", {
  id: serial("id").primaryKey(),
  user_id: text("user_id")
    .references(() => users.id)
    .notNull()
    .unique(),
  first_name: text("first_name"),
  last_name: text("last_name"),
  phone_number: text("phone_number"),
  // Varchar, not date: a date column round-trips as a Date and HCA already sends YYYY-MM-DD.
  birthday: varchar("birthday", { length: 10 }),
  addresses: jsonb("addresses"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export const internalNotesTable = pgTable("internal_notes", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").references(() => users.id),
  project_id: integer("project_id").references(() => projectTable.id),
  note: text("note").notNull(),
  created_by: text("created_by")
    .references(() => users.id)
    .notNull(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

export const projectTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").references(() => users.id),
  name: text("name").notNull(),
  type: text("type", { enum: ["software", "hardware"] }).notNull(),
  description: text("description").notNull(),
  fruit: text("fruit"), // assigned fruit name (e.g. "Cacao", "Mango")
  level: text("level"), // "1" (easiest/Beginner) | "2" | "3" | "4" (hardest/Expert)
  stage: integer("stage").default(1), // 1 (baby) to 4 (mature)
  demo_url: text("demo_url"),
  thumbnail_url: text("thumbnail_url"),
  repository_url: text("repository_url"),
  hackatime_projects: text("hackatime_projects").array(), // linked hackatime project names
  is_fork: boolean("is_fork").default(false),
  guide: text("guide"), // e.g. "html"; null if not created from a guide

  // Source of truth for guide projects, so users without GitHub can come back to the CSS tutorial.
  html_content: text("html_content"),
  css_content: text("css_content"),
  readme_content: text("readme_content"),

  // Last pulled/pushed sha, to detect direct edits to index.html on GitHub.
  last_html_sha: text("last_html_sha"),
  last_css_sha: text("last_css_sha"),

  // "XXXX-XXXX" Crockford base32 minus confusables; unique so redeem can look up by code alone.
  // Lazily minted on first owner read and rotated after each redeem, so effectively single-use.
  invite_code: varchar("invite_code", { length: 9 }).unique(),

  // drives plant stage + payout multiplier
  project_streak_days: integer("project_streak_days").notNull().default(0),
  last_worked_date: varchar("last_worked_date", { length: 10 }), // "YYYY-MM-DD" UTC

  // A freeze only burns when some opted-in project has a live streak; an opted-out project
  // still resets to 0 on that gap day instead of riding along for free.
  auto_use_streak_freezes: boolean("auto_use_streak_freezes").notNull().default(true),

  // Hardware-only, but kept when toggling to software so the data isn't lost.
  // Required to ship hardware projects (canShipProject in policies/projects.ts).
  cart_screenshots: text("cart_screenshots").array(), // CDN URLs of cart/parts list screenshots
  build_cost_cents: integer("build_cost_cents"),

  // Snapshotted onto ship.needs_funding at submit, so hardware ships can alternate between grant and fruit.
  next_ship_needs_funding: boolean("next_ship_needs_funding").notNull().default(false),

  // Explicit student declaration, snapshotted onto ship.is_build_complete_submission. On approval it
  // unlocks pending fruit and syncs to Unified YSWS. Forced false when funding is ticked.
  next_ship_is_build_complete: boolean("next_ship_is_build_complete").notNull().default(false),

  // Snapshotted onto the ship at submit so past AI disclosures survive preference changes.
  // The description is private to the owner and reviewers.
  next_ship_used_ai: boolean("next_ship_used_ai").notNull().default(false),
  next_ship_ai_usage_description: text("next_ship_ai_usage_description"),

  // Snapshotted onto ship.is_update + ship.update_description; submit rejects a blank description when on.
  next_ship_is_update: boolean("next_ship_is_update").notNull().default(false),
  next_ship_update_description: text("next_ship_update_description"),

  // Draft saved as the student types; snapshotted onto ship.reviewer_note at submit, then cleared.
  next_ship_reviewer_note: text("next_ship_reviewer_note"),

  // Soft-delete tombstone: kept for staff review and fraud cleanup, hidden from public/member lookups.
  deleted_at: timestamp("deleted_at"),

  // Set on projects imported from Stasis (server/lib/stasis.ts); stasis_project_id is the idempotent
  // re-import key and the hook for not double-counting hours already credited on Stasis.
  stasis_project_id: text("stasis_project_id"),
  stasis_imported_at: timestamp("stasis_imported_at"),

  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (t) => ({
  userIdx: index("projects_user_id_idx").on(t.user_id),
  // Makes the Stasis import idempotent; partial so non-imported projects are unconstrained.
  stasisIdx: uniqueIndex("projects_user_stasis_id_unique")
    .on(t.user_id, t.stasis_project_id)
    .where(sql`${t.stasis_project_id} IS NOT NULL`),
}));

export const journalsTable = pgTable(
  "journals",
  {
    id: serial("id").primaryKey(),

    project_id: integer("project_id").references(() => projectTable.id).notNull(),
    // Journal author; drives the per-contributor breakdown on group projects.
    user_id: text("user_id").references(() => users.id).notNull(),
    linked_ship: integer("linked_ship").references(() => shipTable.id), // journals are linked to the newest ship on the project

    long_brief: text("long_brief").notNull(),
    attachments: text("attachments").array().notNull(), // cdn.hackclub.com links
    short_brief: text("short_brief").notNull(), // short title or summary of the journal

    // ISO 639-1 source language; null on old rows, which are never auto-translated.
    content_language: varchar("content_language", { length: 5 }),

    // Numeric so partial hours survive; the server rounds to 1 decimal at write time.
    hours: numeric("hours", { precision: 10, scale: 2, mode: "number" }).default(0),
    // Client UUID per submit so retries, multi-tab races and double-clicks collapse to one row.
    client_dedup_key: varchar("client_dedup_key", { length: 64 }),
    created_at: timestamp("created_at").defaultNow(),
    archived: boolean("archived").default(false).notNull(), // hidden from public project pages
    archived_at: timestamp("archived_at"),
    archived_by: text("archived_by").references(() => users.id),

    approved: boolean("approved").default(false), // is the journal approved for hours counting?
    decision_justification: text("decision_justification"),

    // Same precision as hours so partial-hour deflation (e.g. 1.5h instead of 2h) is representable.
    override_hours: numeric("override_hours", { precision: 10, scale: 2, mode: "number" }),
    override_justification: text("override_justification"),

    reviewed: boolean("reviewed").default(false).notNull(),
    reviewed_by: text("reviewed_by").references(() => users.id),
    reviewed_at: timestamp("reviewed_at"),
  },
  (t) => ({
    dedupUnique: uniqueIndex("journals_dedup_unique")
      .on(t.project_id, t.client_dedup_key)
      .where(sql`${t.client_dedup_key} IS NOT NULL`),
    // The dedup index above is partial, so it can't serve plain project_id lookups.
    projectIdx: index("journals_project_id_idx").on(t.project_id),
    linkedShipIdx: index("journals_linked_ship_idx").on(t.linked_ship),
  }),
);

// One row per (project, user) that ever collaborated; a re-join flips the existing row back to 'active'.
// The MAX_COLLABORATORS cap is enforced at the redeem endpoint, not in the DB.
export const projectCollaboratorTable = pgTable(
  "project_collaborators",
  {
    id: serial("id").primaryKey(),
    project_id: integer("project_id")
      .references(() => projectTable.id, { onDelete: "cascade" })
      .notNull(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // "active" | "left" | "removed"; no "pending", code-based joins land straight in active.
    status: text("status").notNull(),
    joined_at: timestamp("joined_at").notNull().defaultNow(),
    left_at: timestamp("left_at"),
    // Only "invite_code" today; text, not enum, so new paths need no migration.
    joined_via: text("joined_via"),
  },
  (t) => ({
    projectUserUnique: uniqueIndex("project_collaborators_project_id_user_id_unique")
      .on(t.project_id, t.user_id),
  }),
);

// Gates per-day streak contribution by linked_at, so unlink+relink can't double-backfill a streak.
// Soft-deleted (is_active = false) so re-adds can be told apart from first-time links.
export const projectHackatimeLinksTable = pgTable(
  "project_hackatime_links",
  {
    id: serial("id").primaryKey(),
    project_id: integer("project_id")
      .references(() => projectTable.id, { onDelete: "cascade" })
      .notNull(),
    hackatime_name: text("hackatime_name").notNull(),
    // project.created_at on first link, now() on re-adds; drives per-day gating in the streak walk.
    linked_at: timestamp("linked_at").notNull(),
    is_active: boolean("is_active").notNull().default(true),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    projectNameUniq: uniqueIndex("project_hackatime_links_project_name_uniq")
      .on(t.project_id, t.hackatime_name),
    projectActiveIdx: index("project_hackatime_links_project_active_idx")
      .on(t.project_id)
      .where(sql`is_active = true`),
  }),
);

// Read per outer row by NOT EXISTS subqueries in the queue and users lists;
// user_id leads the index since it is far more selective than active.
export const shadowBanTable = pgTable(
  "shadow_bans",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id)
      .notNull(),
    reason: text("reason").notNull(),
    created_by_user_id: text("created_by_user_id")
      .references(() => users.id)
      .notNull(),
    created_at: timestamp("created_at").defaultNow(),
    active: boolean("active").default(true).notNull(), // never deleted, to keep a log
  },
  (t) => ({
    userActiveIdx: index("shadow_bans_user_id_active_idx").on(
      t.user_id,
      t.active,
    ),
  }),
);

// HARD ban, unlike shadow_bans: blocks app access (/api/auth/me 401s) and kicks the user from the
// main Macondo Slack channel on every rejoin. Never hard-deleted; lifting sets active = false.
export const macondoBanTable = pgTable(
  "macondo_bans",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id)
      .notNull(),
    reason: text("reason").notNull(), // shown to the banned user on /banned
    // NULL = permanent; compared against now(), so temp bans expire without a cron.
    expires_at: timestamp("expires_at"),
    created_by_user_id: text("created_by_user_id")
      .references(() => users.id)
      .notNull(),
    created_at: timestamp("created_at").defaultNow(),
    active: boolean("active").default(true).notNull(), // false once lifted
    lifted_at: timestamp("lifted_at"),
    lifted_by_user_id: text("lifted_by_user_id").references(() => users.id),
  },
  (t) => ({
    userActiveIdx: index("macondo_bans_user_id_active_idx").on(
      t.user_id,
      t.active,
    ),
  }),
);

export const shipStatus = pgEnum("ship_status", ["under_review", "pending_fraud_review", "shipped_missing_airtable", "shipped", "rejected", "needs_changes", "pending_second_pass"]);
export const grantQueueStatus = pgEnum("grant_queue_status", ["queued", "sent", "cancelled"]);
export const currencyTransactionType = pgEnum("currency_transaction_type", [
  "increase",
  "decrease",
]);
export const currencyTransactionSource = pgEnum("currency_transaction_source", [
  "system",
  "ship_reward",
  "shop_purchase",
  "staff_reward",
  "manual_adjustment",
  "referral_reward",
  "nps_feedback",
  "fruit_unlock",
  "fruit_gift",
  "shop_refund",
  // Always fruit_type='starfruit', amount=1, unlocked_at=now().
  "extra_fruity_reward",
  // One-time per (user, item); paired with a shop_item_unlocks row pointing at this transaction.
  "shop_unlock",
  // historical only: no longer paid since 2026-09-02; old rows are still reversed by revert-ship
  "review_reward",
  // Gold prizes from approved event gifts only; free shop-item gifts never hit this ledger.
  "event_prize",
  // Supaadmin gold adjustment; `memo` is a required staff note also shown to the maker.
  // Reversed by flipping counts=false, never deleted.
  "admin_adjustment",
]);
export const shopItemKind = pgEnum("shop_item_kind", [
  "physical",
  "grant",
  "consumable",
  "experience",
  "virtual_service",
]);
export const shopFulfillmentProvider = pgEnum("shop_fulfillment_provider", [
  "internal",
  "theseus",
  "hcb",
  "internal_synthetic",
]);
export const shopItemSource = pgEnum("shop_item_source", ["hq", "local"]);
export const shopInventoryMode = pgEnum("shop_inventory_mode", [
  "unlimited",
  "limited",
]);
export const shopOrderStatus = pgEnum("shop_order_status", [
  "pending_internal_fulfillment",
  "shipped",
  "service_activated",
  "grant_pending",
  "grant_created",
  "theseus_submitted",
  "external_failure",
  "cancelled",
]);

export const shipTable = pgTable("ships", {
  id: serial("id").primaryKey(),

  user_id: text("user_id")
    .references(() => users.id)
    .notNull(),
  project_id: integer("project_id")
    .references(() => projectTable.id)
    .notNull(),

  hackatime_projects: text("hackatime_projects").array(),
  hackatime_hours: numeric("hackatime_hours", { precision: 10, scale: 2, mode: "number" }), // decimal so partial hours survive end to end
  linked_journals: integer("linked_journals").array(),

  status: shipStatus("status").notNull().default("under_review"),

  software_override_hours: numeric("software_override_hours", { precision: 10, scale: 2, mode: "number" }).default(0), // decimals allow partial-hour deflation
  software_override_reason: text("software_override_reason"),
  // Internal reasoning behind THIS decision, synced to Airtable; never shown to the student. English only.
  decision_audit_notes: text("decision_audit_notes"),
  // Shown on the project page and emailed on rejected / needs_changes.
  decision_user_message: text("decision_user_message"),
  // Reviewer-edited translations keyed by locale, served instead of re-translating (auto ones live in Redis).
  decision_user_message_translations: jsonb("decision_user_message_translations").$type<Record<string, string>>(),
  decision_user_message_attachments: jsonb("decision_user_message_attachments").$type<
    Array<{ url: string; filename: string; mime_type: string; sha: string }>
  >(),
  override_reason: text("override_reason"),
  override_hours: numeric("override_hours", { precision: 10, scale: 2, mode: "number" }).default(0), // final approved hours: hackatime + journals after reviewer deflation

  assigned_user_id: text("assigned_user_id").references(() => users.id),

  // Set only on human request_changes; kept for attribution.
  last_request_changes_reviewer_id: text("last_request_changes_reviewer_id").references(() => users.id),

  // Snapshot of project.next_ship_needs_funding at submit; the approve path picks grant vs fruit from it.
  needs_funding: boolean("needs_funding").notNull().default(false),
  // Frozen at submit so later project edits don't change the grant amount.
  needs_funding_amount_cents: integer("needs_funding_amount_cents"),
  // Hours of this ship that went to funded parts work; fruit is paid for the rest.
  // Null on old ships, which the approver treats as all hours funded.
  needs_funding_hours: integer("needs_funding_hours"),
  // Reviewer override; takes precedence over needs_funding_hours when set.
  needs_funding_hours_override: integer("needs_funding_hours_override"),

  // Frozen at submit so reviewers see what was disclosed then; the description is owner + reviewers only.
  used_ai: boolean("used_ai").notNull().default(false),
  ai_usage_description: text("ai_usage_description"),

  // Reviewer must confirm a second+ ship's new work is real before approve unlocks; persisted to survive refresh.
  update_verified_by_reviewer: boolean("update_verified_by_reviewer").notNull().default(false),

  // Note from the student TO the reviewer, shown on the internal review page.
  reviewer_note: text("reviewer_note"),

  // Approving a ship with this set unlocks every pending fruit row on the project (pending_for_project_id).
  is_build_complete_submission: boolean("is_build_complete_submission").notNull().default(false),

  // A needs_funding ship on a project with a queued/sent grant from an earlier ship; cancelled grants don't count.
  is_subsequent_grant_request: boolean("is_subsequent_grant_request").notNull().default(false),
  // Previous active grant amount at submit, so reviewers see old vs new without an extra query.
  previous_grant_amount_cents: integer("previous_grant_amount_cents"),

  // Server-detected at submit whenever the project already has a shipped ship, regardless of the student's toggle.
  is_update: boolean("is_update").notNull().default(false),
  update_description: text("update_description"),

  // Reviewer flag for an exceptional build; approval awards the maker 1 starfruit.
  extra_fruity: boolean("extra_fruity").notNull().default(false),

  // Frozen so a long review queue can't downgrade the multiplier; approval uses max(this, live streak).
  // Null on old ships means live streak only.
  project_streak_days_at_submission: integer("project_streak_days_at_submission"),
  // Recovery anchor for streak-under-review protection; re-stamped on resubmit.
  project_last_worked_date_at_submission: varchar("project_last_worked_date_at_submission", { length: 10 }),
  // Floors the DISPLAYED user streak during an open review window (null = no floor);
  // project_streak_days_at_submission floors the payout multiplier instead.
  user_streak_at_submission: integer("user_streak_at_submission"),

  // Filled in the background by server/lib/auto-checks.ts; null while running or if no checks could run.
  auto_check_result: jsonb("auto_check_result").$type<AutoCheckResult>(),
  auto_check_run_at: timestamp("auto_check_run_at"),

  // ARI mirror state, null on ships never pushed to ARI. ari_last_event keeps the inbound payload
  // verbatim for the idempotency check and review surfaces.
  ari_submission_id: text("ari_submission_id"),
  ari_status: text("ari_status"),
  ari_synced_at: timestamp("ari_synced_at", { withTimezone: true }),
  ari_last_event: jsonb("ari_last_event").$type<AriInboundEvent>(),
  // Stamped on EVERY park so a revert + re-approve can't leak a stale value; locks the ship_reward
  // gold to priority-eligible shop items.
  ari_priority: boolean("ari_priority").notNull().default(false),

  // Set when escalated to the YSWS Fraud API; poll-fraud returns the ship to review when trustScore > 4
  // and auto-rejects at <= 4 (score is 1-10).
  fraud_project_id: text("fraud_project_id"),
  fraud_trust_score: integer("fraud_trust_score"),
  fraud_justification: text("fraud_justification"),
  fraud_reviewed_at: timestamp("fraud_reviewed_at"),
  // Set once our final decision is POSTed back to the upstream fraud API.
  fraud_outcome_recorded_at: timestamp("fraud_outcome_recorded_at"),
  // Legacy 'approved' | 'rejected' verdict on already-paid ships; new ships go through ARI instead.
  fraud_outcome: text("fraud_outcome"),
  // Round-robin cursor: the poll orders by it ASC NULLS FIRST so the whole backlog drains across ticks.
  fraud_last_polled_at: timestamp("fraud_last_polled_at"),

  // Fraud API intentionally skipped on a low-effort resubmit; suppresses the "No fraud check" badge.
  fraud_review_skipped: boolean("fraud_review_skipped").notNull().default(false),

  // Lets force-resync PATCH the existing Airtable row instead of POSTing a duplicate.
  airtable_record_id: text("airtable_record_id"),

  // airtable-repair cursor, ordered ASC NULLS FIRST so a large backlog drains across ticks.
  last_airtable_repair_at: timestamp("last_airtable_repair_at"),

  // Second-pass gate: a reviewer approval lands in pending_second_pass with a frozen reward snapshot
  // until a supaadmin finalizes. Null on ships that never entered second pass.
  // The first-pass reviewer, not the supaadmin, gets the approve_ship audit credit.
  first_pass_reviewer_id: text("first_pass_reviewer_id").references(() => users.id),
  // Distinct from reviewed_at, which stays NULL until a supaadmin finalizes.
  first_pass_approved_at: timestamp("first_pass_approved_at"),
  // Snapshotted so finalize builds the approval attribution as the reviewer chose.
  first_pass_reveal_identity: boolean("first_pass_reveal_identity").notNull().default(false),
  // Null while the ship is still awaiting second pass.
  second_pass_actioned_at: timestamp("second_pass_actioned_at", { withTimezone: true }),

  // Frozen at reviewer-approve: only values that can drift before finalize; the rest is recomputed.
  // Already multiplier-adjusted, level rate applied.
  second_pass_gold_reward: integer("second_pass_gold_reward"),
  // for memo/notify copy
  second_pass_multiplier: numeric("second_pass_multiplier", { precision: 10, scale: 2, mode: "number" }),
  // delta applied to users.lifetime_fruits_earned
  second_pass_lifetime_fruit_delta: integer("second_pass_lifetime_fruit_delta"),
  // Frozen so a level edit during the wait can't change the payout tier.
  second_pass_assigned_fruit: text("second_pass_assigned_fruit"),
  // Frozen group split; amounts sum to second_pass_gold_reward, empty/null when the reward was 0.
  second_pass_contributor_split: jsonb("second_pass_contributor_split").$type<
    Array<{ user_id: string; amount: number; hours: number }>
  >(),

  created_at: timestamp("created_at").defaultNow(),
  reviewed_at: timestamp("reviewed_at"),
  // Refreshed on every return to the queue so a rejoining ship lands at the back of the line;
  // created_at stays the immutable original-submit anchor.
  queue_entered_at: timestamp("queue_entered_at", { withTimezone: true })
    .notNull()
    .defaultNow()
}, (t) => ({
  // statusReviewedAt lets /api/internal/shipped filter by status and order by reviewed_at in one index scan.
  statusIdx: index("ships_status_idx").on(t.status),
  projectIdx: index("ships_project_id_idx").on(t.project_id),
  userStatusIdx: index("ships_user_id_status_idx").on(t.user_id, t.status),
  assignedIdx: index("ships_assigned_user_id_idx").on(t.assigned_user_id),
  reviewedAtIdx: index("ships_reviewed_at_idx").on(t.reviewed_at),
  statusReviewedAtIdx: index("ships_status_reviewed_at_idx").on(
    t.status,
    t.reviewed_at,
  ),
  lastAirtableRepairAtIdx: index("ships_last_airtable_repair_at_idx").on(
    t.last_airtable_repair_at,
  ),
}));

// One row per (ship, user) for the owner + active collaborators at submit; approved_hours is null until reviewed.
// fruit_awarded is this contributor's slice, so the dashboard doesn't re-run the payout math.
export const shipContributorsTable = pgTable(
  "ship_contributors",
  {
    id: serial("id").primaryKey(),
    ship_id: integer("ship_id")
      .references(() => shipTable.id, { onDelete: "cascade" })
      .notNull(),
    user_id: text("user_id")
      .references(() => users.id)
      .notNull(),
    hackatime_hours: numeric("hackatime_hours", { precision: 10, scale: 2, mode: "number" })
      .notNull()
      .default(0),
    approved_hours: numeric("approved_hours", { precision: 10, scale: 2, mode: "number" }),
    fruit_awarded: numeric("fruit_awarded", { precision: 14, scale: 4, mode: "number" }),
    // Unified pays a person, so a group ship files one row per member; the owner's id is also
    // written to ships.airtable_record_id so existing repair/resync paths keep working.
    airtable_record_id: text("airtable_record_id"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    shipUserUnique: uniqueIndex("ship_contributors_ship_id_user_id_unique")
      .on(t.ship_id, t.user_id),
  }),
);

export const shopItemTable = pgTable(
  "shop_items",
  {
  id: serial("id").primaryKey(),
  // Stable id for items code dispatches on (e.g. streak_freeze in shop/orders.post.ts).
  slug: text("slug"),
  name: text("name").notNull(),
  description: text("description"),
  // Admin-edited translations served instead of AI translation; English stays in name/description.
  name_translations: jsonb("name_translations").$type<Record<string, string>>(),
  description_translations: jsonb("description_translations").$type<Record<string, string>>(),
  price_hours: integer("price_hours").notNull(),
  // Fruit pricing, either price_fruit_type (legacy, one specific fruit) or price_fruit_level (1..4) +
  // price_fruit_category. Fruit-priced items ignore price_hours and regional pricing.
  price_fruit_type: text("price_fruit_type"),
  price_fruit_amount: integer("price_fruit_amount"),
  price_fruit_level: integer("price_fruit_level"),
  price_fruit_category: text("price_fruit_category"),
  image_url: text("image_url"),
  kind: shopItemKind("kind").notNull().default("physical"),
  fulfillment_provider: shopFulfillmentProvider("fulfillment_provider")
    .notNull()
    .default("internal"),
  source: shopItemSource("source"),
  grant_amount_cents: integer("grant_amount_cents"),
  attachment_urls: text("attachment_urls")
    .array()
    .notNull()
    .default(sql`ARRAY[]::text[]`),
  inventory_mode: shopInventoryMode("inventory_mode")
    .notNull()
    .default("unlimited"),
  stock_remaining: integer("stock_remaining"),
  // Per-user cap across all orders not in "external_failure"; NULL = no cap.
  max_per_user: integer("max_per_user"),
  // Sale price when below price_hours; NULL = no sale. Grant dollar amounts are set separately.
  sale_price_hours: integer("sale_price_hours"),
  // Delists the item after this time; it does NOT change the price.
  available_until: timestamp("available_until"),
  available: boolean("available").default(true),
  coming_soon: boolean("coming_soon").notNull().default(false),
  // Only users with at least one shipped project can buy; enforced in shop/orders.post.ts.
  requires_shipped_project: boolean("requires_shipped_project").notNull().default(false),
  // Forces the item to the top of the shop, ignoring the currency filter and sort.
  pinned: boolean("pinned").notNull().default(false),
  // Must be unlocked once per user with 1 starfruit (shop_item_unlocks) before normal purchase.
  extra_fruity: boolean("extra_fruity").notNull().default(false),
  // Priority-review gold can ONLY buy items with this on; regular gold still buys it as usual.
  priority_eligible: boolean("priority_eligible").notNull().default(false),
  // Per-ShopRegion overrides, only for kind="physical"; missing fields fall back to base defaults.
  // store_url is the reference listing and is required whenever a price is overridden.
  regional_pricing: jsonb("regional_pricing").$type<
    Partial<Record<string, { price_hours?: number; available?: boolean; store_url?: string }>>
  >(),
  // price_delta_hours stack additively on the base price; [] is normalized to null.
  // Text modifiers (e.g. engraving) use type "text" with options always [].
  modifiers: jsonb("modifiers").$type<
    Array<{
      id: string;
      label: string;
      label_translations?: Record<string, string>;
      type: "single" | "multi" | "text";
      required?: boolean;
      options: Array<{
        id: string;
        label: string;
        label_translations?: Record<string, string>;
        price_delta_hours: number;
      }>;
      max_length?: number;
      placeholder?: string;
      placeholder_translations?: Record<string, string>;
      price_delta_hours?: number;
    }>
  >(),
  // Validated app-side against SHOP_ITEM_CATEGORIES; text so the taxonomy grows without a migration.
  category: text("category"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("shop_items_slug_unique").on(t.slug),
  }),
);

// Shop item changes awaiting the bulk Slack announcement (server/lib/shop-slack-log.ts).
// Deliberately no FK to shop_items: delete changes must outlive the deleted row.
export const shopPendingChangeTable = pgTable("shop_pending_changes", {
  id: serial("id").primaryKey(),
  item_id: integer("item_id").notNull(),
  action: text("action").notNull(),
  old_value: jsonb("old_value"),
  new_value: jsonb("new_value"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

export const shopOrderTable = pgTable("shop_orders", {
  id: serial("id").primaryKey(),
  user_id: text("user_id")
    .references(() => users.id)
    .notNull(),
  item_id: integer("item_id")
    .references(() => shopItemTable.id)
    .notNull(),
  quantity: integer("quantity").notNull().default(1),
  status: shopOrderStatus("status")
    .notNull()
    .default("pending_internal_fulfillment"),
  item_snapshot: jsonb("item_snapshot").notNull(),
  // Labels and price deltas frozen at purchase so later admin edits don't rewrite history.
  // Text selections resolve to one option with id "text"; text_value duplicates it.
  selected_modifiers: jsonb("selected_modifiers").$type<
    Array<{
      modifier_id: string;
      modifier_label: string;
      type: "single" | "multi" | "text";
      options: Array<{
        option_id: string;
        label: string;
        price_delta_hours: number;
      }>;
      text_value?: string;
    }>
  >(),
  shipping_address: jsonb("shipping_address"),
  phone: text("phone"),
  // Physical orders only; rendered as escaped plain text with URLs auto-linked, never as markup.
  fulfillment_note: text("fulfillment_note"),
  tracking_number: text("tracking_number"),
  external_reference: text("external_reference"),
  fulfillment_error: text("fulfillment_error"),
  address_encrypted: text("address_encrypted"),
  // Frozen at insert from the shipping country (null for grants); read with item_snapshot.price_gold for refunds.
  region: varchar("region", { length: 2 }),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
});

// Admins cluster duplicates, look up pricing and promote these at /internal/shop-requests.
export const shopItemRequestTable = pgTable("shop_item_requests", {
  id: serial("id").primaryKey(),
  user_id: text("user_id")
    .references(() => users.id)
    .notNull(),
  name: text("name").notNull(),
  description: text("description"),
  store_url: text("store_url"),
  image_url: text("image_url"),
  // NULL until an admin runs "group similar items"; a shared cluster_id means AI-grouped.
  cluster_id: integer("cluster_id"),
  // NULL until an admin clicks "Find stores & pricing".
  pricing_info: jsonb("pricing_info").$type<{
    stores: Array<{
      store_name: string;
      likely_url: string;
      estimated_price_usd: number | null;
      notes?: string;
    }>;
    fetched_at: string;
  }>(),
  // Set to the shop_items.id when admin promotes a request. NULL = still pending.
  promoted_to_item_id: integer("promoted_to_item_id").references(
    () => shopItemTable.id,
  ),
  dismissed_at: timestamp("dismissed_at"),
  dismissed_by: text("dismissed_by").references(() => users.id),
  // Optional; older dismissals don't have it.
  dismissed_reason: text("dismissed_reason"),
  // Denormalized so the list can ORDER BY without a JOIN; updated in the vote endpoint's tx.
  upvote_count: integer("upvote_count").notNull().default(0),
  downvote_count: integer("downvote_count").notNull().default(0),
  // AI-assigned at submit (server/lib/shop-request-tag.ts) so new rows group on the browse page; NULL if tagging failed.
  group_tag: varchar("group_tag", { length: 80 }),
  // When false (default) the public list shows the row as "Anonymous".
  show_username: boolean("show_username").notNull().default(false),
  created_at: timestamp("created_at").defaultNow(),
}, (t) => ({
  groupTagIdx: index("shop_item_requests_group_tag_idx")
    .on(t.group_tag)
    .where(sql`${t.group_tag} IS NOT NULL`),
  upvoteCountIdx: index("shop_item_requests_upvote_count_idx")
    .on(sql`${t.upvote_count} DESC`),
  downvoteCountIdx: index("shop_item_requests_downvote_count_idx")
    .on(sql`${t.downvote_count} DESC`),
}));

// The vote endpoint toggles by insert/delete and updates the request's counters in the same tx.
export const shopItemRequestVoteTable = pgTable(
  "shop_item_request_votes",
  {
    id: serial("id").primaryKey(),
    request_id: integer("request_id")
      .references(() => shopItemRequestTable.id, { onDelete: "cascade" })
      .notNull(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    first_voted_at: timestamp("first_voted_at"),
    direction: varchar("direction", { length: 8 }).notNull().default("up"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("shop_item_request_votes_unique").on(t.request_id, t.user_id),
    requestIdx: index("shop_item_request_votes_request_idx").on(t.request_id),
    userIdx: index("shop_item_request_votes_user_idx").on(t.user_id),
  }),
);

// Per-viewer version of the `pinned` flag: starred items render after pinned ones, before the rest.
export const shopItemStarTable = pgTable(
  "shop_item_stars",
  {
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    item_id: integer("item_id")
      .notNull()
      .references(() => shopItemTable.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex("shop_item_stars_pk").on(t.user_id, t.item_id),
  }),
);

// A row exists iff the user spent 1 starfruit to unlock the item; the unique index prevents double charges.
// The item FK has no cascade, so items must be soft-disabled (available=false), not deleted.
export const shopItemUnlockTable = pgTable(
  "shop_item_unlocks",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    item_id: integer("item_id")
      .notNull()
      .references(() => shopItemTable.id),
    currency_transaction_id: integer("currency_transaction_id").references(
      () => currencyTransactionTable.id,
    ),
    unlocked_at: timestamp("unlocked_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex("shop_item_unlocks_user_item_idx").on(t.user_id, t.item_id),
  }),
);

export const currencyTransactionTable = pgTable(
  "currency_transactions",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id)
      .notNull(),

    // Absolute amount (direction lives in `type`); numeric for fractional rewards like 7 x 1.05.
    amount: numeric("amount", { precision: 14, scale: 4, mode: "number" }).notNull(),
    type: currencyTransactionType("type").notNull(),
    source: currencyTransactionSource("source").notNull().default("system"),
    // null = gold; otherwise the fruit name (matches fruitLevels.ts).
    fruit_type: text("fruit_type"),
    memo: text("memo"),

    // null means it came from the system rather than a staff member
    created_by_user_id: text("created_by_user_id").references(() => users.id),

    ship_id: integer("ship_id").references(() => shipTable.id),
    shop_order_id: integer("shop_order_id").references(() => shopOrderTable.id),

    // unlocked_at IS NULL = earned but locked (pending hardware fruit): no balance, convert, gift or spend.
    // Defaults to now() so only the pending branch in review.post.ts writes null.
    unlocked_at: timestamp("unlocked_at").defaultNow(),
    pending_for_project_id: integer("pending_for_project_id").references(() => projectTable.id),
    pending_for_ship_id: integer("pending_for_ship_id").references(() => shipTable.id),

    // Priority ARI gold, spendable only on priority_eligible items. Only increase rows carry true,
    // so excluding it is a simple column filter.
    priority: boolean("priority").notNull().default(false),

    // transactions stay in history; this decides whether they affect balance
    counts: boolean("counts").notNull().default(true),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pendingForProjectIdx: index("currency_transactions_pending_for_project_idx")
      .on(t.pending_for_project_id, t.user_id)
      .where(sql`${t.unlocked_at} IS NULL`),
    // Balance reads filter (user_id, counts), which the partial pending index can't serve.
    userCountsIdx: index("currency_transactions_user_id_counts_idx").on(t.user_id, t.counts),
    shipIdx: index("currency_transactions_ship_id_idx").on(t.ship_id),
  }),
);

// One row per (ship, UTC day). Insert BEFORE sending: the unique idempotency_key lets the DB decide
// which cron instance sends, since the overlap guard in cron-overlap.ts is per-process.
export const reviewEscalationsTable = pgTable(
  "review_escalations",
  {
    id: serial("id").primaryKey(),
    ship_id: integer("ship_id")
      .notNull()
      .references(() => shipTable.id, { onDelete: "cascade" }),
    // '<shipId>:<YYYY-MM-DD>' UTC, from escalationDayKey().
    idempotency_key: text("idempotency_key").notNull(),
    day_key: date("day_key").notNull(),
    // 'channel' | 'role' | 'owner' — which rung of the ladder fired.
    tier: text("tier").notNull(),
    days_waiting: integer("days_waiting").notNull(),
    slack_channel: text("slack_channel"),
    slack_ts: text("slack_ts"),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idempotencyIdx: uniqueIndex("review_escalations_idempotency_key_idx").on(
      t.idempotency_key,
    ),
    shipIdx: index("review_escalations_ship_idx").on(t.ship_id, t.day_key),
  }),
);

export const auditLogTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  actor_id: text("actor_id").references(() => user.id).notNull(),

  action: text("action").notNull(), // 'create', 'update', 'delete', 'approve_journal', etc.
  entity_type: text("entity_type").notNull(), // 'project', 'user', 'ship', 'journal', etc.
  entity_id: text("entity_id").notNull(),

  old_value: jsonb("old_value"),
  new_value: jsonb("new_value"),

  sensitive: boolean("sensitive").default(false).notNull(), // hide full details from public timelines when true
  public_message: text("public_message"), // optional user-friendly message safe to show to non-privileged users

  change_summary: text("change_summary"),

  created_at: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  // Hot paths filter recent rows by (entity_type, action) without entity_id, which entity_idx can't serve.
  entityIdx: index("audit_logs_entity_idx").on(t.entity_type, t.entity_id, t.created_at),
  entityActionIdx: index("audit_logs_entity_action_idx").on(
    t.entity_type,
    t.action,
    t.created_at,
  ),
  actorIdx: index("audit_logs_actor_id_idx").on(t.actor_id),
  actorActionIdx: index("audit_logs_actor_action_idx").on(
    t.actor_id,
    t.action,
    t.created_at,
  ),
}));

// Snapshot of a nuked user and every row that referenced them, so a supaadmin can restore it.
// nuked_by_user_id is not an FK so it survives the nuker being nuked later.
export const userBackupTable = pgTable("user_backups", {
  id: serial("id").primaryKey(),
  original_user_id: text("original_user_id").notNull(),
  original_email: text("original_email").notNull(),
  original_name: text("original_name").notNull(),
  nuked_by_user_id: text("nuked_by_user_id"),
  nuked_by_name: text("nuked_by_name"),
  nuked_at: timestamp("nuked_at").defaultNow().notNull(),
  reason: text("reason"),
  payload: jsonb("payload").notNull(),
  restored_at: timestamp("restored_at"),
  restored_by_user_id: text("restored_by_user_id"),
});

export const hackatimeSyncAuditTable = pgTable("hackatime_sync_audits", {
  id: serial("id").primaryKey(),
  user_id: text("user_id").references(() => users.id).notNull(),
  total_hours: numeric("total_hours", { precision: 10, scale: 2, mode: "number" }).notNull(),
  delta_hours: numeric("delta_hours", { precision: 10, scale: 2, mode: "number" }).notNull().default(0),
  sync_date: varchar("sync_date", { length: 10 }).notNull(), // "YYYY-MM-DD" UTC
  extended_streak: boolean("extended_streak").notNull().default(false),
  source: text("source").notNull(), // "manual_admin" | "dashboard_auto" | "first_sync_seed"
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// Enqueued on approve when ship.needs_funding; sent/cancelled/reissued via /api/internal/grants.
export const projectGrantTable = pgTable(
  "project_grants",
  {
    id: serial("id").primaryKey(),
    project_id: integer("project_id")
      .references(() => projectTable.id)
      .notNull(),
    ship_id: integer("ship_id")
      .references(() => shipTable.id)
      .notNull(),
    user_id: text("user_id")
      .references(() => users.id)
      .notNull(),
    // Frozen from ship.needs_funding_amount_cents so later project edits don't change it.
    amount_cents: integer("amount_cents").notNull(),
    status: grantQueueStatus("status").notNull().default("queued"),

    hcb_grant_id: text("hcb_grant_id"),
    hcb_response: jsonb("hcb_response"),
    sent_by_user_id: text("sent_by_user_id").references(() => users.id),
    sent_at: timestamp("sent_at"),

    cancelled_by_user_id: text("cancelled_by_user_id").references(
      () => users.id,
    ),
    cancelled_at: timestamp("cancelled_at"),
    cancel_reason: text("cancel_reason"),
    // Fallback fruit tx from "cancel + award fruit"; Reverse sets its counts=false and clears this.
    cancel_fruit_tx_id: integer("cancel_fruit_tx_id").references(
      () => currencyTransactionTable.id,
    ),

    // The cancelled grant this reissue was created from.
    reissued_from_id: integer("reissued_from_id"),

    // Precomputed so the grants page can label Send without hitting HCB per row; re-verified at send.
    // top_up: prior card active, reissue: prior card cancelled/expired; NULL is treated as first_card.
    intended_send_action: text("intended_send_action", {
      enum: ["first_card", "top_up", "reissue"],
    }),
    // HCB-side id of the cancelled card this one replaces (our own id is in reissued_from_id).
    hcb_card_replaces_id: text("hcb_card_replaces_id"),

    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // At most one queued/sent grant per ship; cancelled rows stay as history.
    shipIdActiveUnique: uniqueIndex("project_grants_ship_id_active_unique")
      .on(t.ship_id)
      .where(sql`status IN ('queued','sent')`),
  }),
);

// Support tickets: Postgres is the source of truth; Slack is a bidirectional mirror when configured.

export const ticketStatus = pgEnum("ticket_status", [
  "open",
  "claimed",
  "resolved",
  "closed",
]);

export const ticketCategory = pgEnum("ticket_category", [
  "project",
  "payout",
  "account",
  "shop",
  "bug",
  "other",
]);

export const ticketPriority = pgEnum("ticket_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const supportTicketTable = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    subject: text("subject").notNull(),
    body: text("body").notNull(),
    category: ticketCategory("category").notNull().default("other"),
    priority: ticketPriority("priority").notNull().default("normal"),
    status: ticketStatus("status").notNull().default("open"),

    related_ship_id: integer("related_ship_id").references(() => shipTable.id),
    related_project_id: integer("related_project_id").references(
      () => projectTable.id,
    ),

    slack_channel_id: varchar("slack_channel_id"),
    slack_thread_ts: varchar("slack_thread_ts"),
    bts_channel_id: varchar("bts_channel_id"),
    bts_message_ts: varchar("bts_message_ts"),

    claimed_by_user_id: text("claimed_by_user_id").references(() => users.id),
    claimed_at: timestamp("claimed_at"),
    resolved_by_user_id: text("resolved_by_user_id").references(() => users.id),
    resolved_at: timestamp("resolved_at"),

    // Set when the "resolved in 24h" warning posts; cleared by the next qualifying public message.
    auto_resolve_warned_at: timestamp("auto_resolve_warned_at"),

    csat_rating: integer("csat_rating"),
    csat_comment: text("csat_comment"),
    csat_submitted_at: timestamp("csat_submitted_at"),

    // subject + body embedding for Capybara's similar-ticket replies; null on rows not yet backfilled.
    embedding: vector1536("embedding"),

    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("support_tickets_status_idx").on(t.status),
    userIdx: index("support_tickets_user_idx").on(t.user_id),
    slackThreadUnique: uniqueIndex(
      "support_tickets_slack_thread_unique",
    ).on(t.slack_channel_id, t.slack_thread_ts),
  }),
);

export const supportTicketMessageTable = pgTable(
  "support_ticket_messages",
  {
    id: serial("id").primaryKey(),
    ticket_id: integer("ticket_id")
      .references(() => supportTicketTable.id, { onDelete: "cascade" })
      .notNull(),
    // Null for system messages (e.g. Capybara); check author_kind to discriminate.
    author_user_id: text("author_user_id").references(() => users.id),
    // "user" | "capybara" | "supporter_llm" (KB agent posting as Capybara) | "slack_external"
    // (Slack replier with no Macondo account; identity in slack_author_*).
    author_kind: text("author_kind").notNull().default("user"),
    body: text("body").notNull(),
    is_internal_note: boolean("is_internal_note").notNull().default(false),
    slack_ts: varchar("slack_ts"),
    // Only for author_kind = "slack_external"; lets the UI attribute a reply without inventing an account.
    slack_author_id: varchar("slack_author_id"),
    slack_author_name: text("slack_author_name"),
    slack_author_image: text("slack_author_image"),
    // Client UUID so web double-clicks/retries collapse to one row; Slack rows rely on event-id dedup.
    client_dedup_key: varchar("client_dedup_key", { length: 64 }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    // Captured from Slack message_changed/message_deleted; original_body keeps the very first version.
    edited_at: timestamp("edited_at"),
    deleted_at: timestamp("deleted_at"),
    original_body: text("original_body"),
  },
  (t) => ({
    ticketIdx: index("support_ticket_messages_ticket_idx").on(t.ticket_id),
    dedupUnique: uniqueIndex("support_ticket_messages_dedup_unique")
      .on(t.ticket_id, t.client_dedup_key)
      .where(sql`${t.client_dedup_key} IS NOT NULL`),
    // Serves the auto-resolve sweep's latest-public-human-message lookups.
    publicLatestIdx: index("support_ticket_messages_public_latest_idx")
      .on(t.ticket_id, t.created_at)
      .where(
        sql`${t.is_internal_note} = false AND ${t.deleted_at} IS NULL AND ${t.author_kind} = 'user'`,
      ),
  }),
);

export const supportTicketAttachmentTable = pgTable(
  "support_ticket_attachments",
  {
    id: serial("id").primaryKey(),
    message_id: integer("message_id")
      .references(() => supportTicketMessageTable.id, { onDelete: "cascade" })
      .notNull(),
    url: text("url").notNull(),
    filename: text("filename").notNull(),
    size_bytes: integer("size_bytes"),
    mime_type: varchar("mime_type"),
    sha: varchar("sha"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    messageIdx: index("support_ticket_attachments_message_idx").on(t.message_id),
  }),
);

export const notificationType = pgEnum("notification_type", [
  "ship_approved",
  "ship_rejected",
  "ship_needs_changes",
  "ship_fraud_escalated",
  // Tells the user an earlier bad-news email was reversed and can be ignored.
  "ship_decision_reversed",
  // Awards 1 starfruit; per ship, so it never affects sibling ships.
  "ship_extra_fruity",
  "grant_sent",
  "grant_cancelled",
  "hardware_grant_sent",
  "shop_grant_sent",
  "shop_grant_fallback_sent",
  // Carries the tracking number; fired on the transition into shipped.
  "shop_order_shipped",
  "ticket_reply",
  "ticket_resolved",
  "ticket_reopened",
  // One summary per unlock batch, not one per row.
  "pending_fruit_unlocked",
  "fruit_gift_received",
  // Only on the FIRST upvote per (project, upvoter) via first_upvoted_at; never for the owner.
  "project_upvoted",
  // Never to the submitter; routed to the "tickets" prefs bucket so muting ticket replies mutes these.
  "shop_request_upvoted",
  "collab_joined_via_code",
  "collab_left",
  // Past journals stay on the project.
  "collab_removed",
  // Sent to each non-owner contributor who earned > 0 fruit; the owner gets ship_approved.
  "collab_ship_approved",
  // One summary per reconcile run so a silently spent freeze doesn't surprise the maker.
  "streak_freeze_used",
  // Fanned out one row per user at broadcast; the body is Markdown.
  "admin_announcement",
  // In-app only; links to /achievements.
  "achievement_unlocked",
  // In-app only; links to the dashboard.
  "event_prize",
  // ~30 minutes before an RSVP'd event; Slack-gated by the "events" preference.
  "event_reminder",
  // In-app only; fired for both the adjustment and its later reversal.
  "gold_adjusted",
  // Celebratory copy, in-app + Slack.
  "show_and_tell_won",
  "show_and_tell_participated",
]);

export const notificationChannel = pgEnum("notification_channel", [
  "in_app",
  "slack",
  "email",
]);

export const notificationDeliveryStatus = pgEnum(
  "notification_delivery_status",
  ["pending", "sent", "failed", "skipped"],
);

export const notificationTable = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: notificationType("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    action_url: text("action_url"),
    entity_type: varchar("entity_type"),
    entity_id: varchar("entity_id"),
    read_at: timestamp("read_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    unreadIdx: index("notifications_user_unread_idx").on(t.user_id, t.read_at),
  }),
);

export const notificationDeliveryTable = pgTable(
  "notification_deliveries",
  {
    id: serial("id").primaryKey(),
    notification_id: integer("notification_id")
      .references(() => notificationTable.id, { onDelete: "cascade" })
      .notNull(),
    channel: notificationChannel("channel").notNull(),
    status: notificationDeliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    next_retry_at: timestamp("next_retry_at"),
    sent_at: timestamp("sent_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    retryIdx: index("notification_deliveries_retry_idx").on(
      t.status,
      t.next_retry_at,
    ),
    notificationIdx: index("notification_deliveries_notification_idx").on(
      t.notification_id,
    ),
  }),
);

export const notificationPreferencesTable = pgTable(
  "notification_preferences",
  {
    user_id: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    preferences: jsonb("preferences").notNull().$type<{
      ship_decisions?: { in_app?: boolean; slack?: boolean; email?: boolean };
      payouts?: { in_app?: boolean; slack?: boolean; email?: boolean };
      tickets?: { in_app?: boolean; slack?: boolean; email?: boolean };
      // Event announcements (in_app) and the 30-min reminder DM (slack).
      events?: { in_app?: boolean; slack?: boolean; email?: boolean };
    }>(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
);

// Canonical record per broadcast; users get fanned-out `notifications` rows, so edits never rewrite sent copies.
export const announcementTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title_en: text("title_en").notNull(),
  body_en: text("body_en").notNull(),
  // Nullable so a broadcast still succeeds when the translator is down (ES users get English).
  title_es: text("title_es"),
  body_es: text("body_es"),
  created_by: text("created_by")
    .references(() => users.id)
    .notNull(),
  recipient_count: integer("recipient_count").notNull().default(0),
  // posted_to_slack_at doubles as the guard against reposting. posted_to_site=false marks Slack-only
  // posts; author_spoofed means the post wore the author's handle instead of Capybara's.
  slack_channel_id: varchar("slack_channel_id"),
  slack_message_ts: varchar("slack_message_ts"),
  posted_to_slack_at: timestamp("posted_to_slack_at"),
  posted_to_site: boolean("posted_to_site").notNull().default(true),
  author_spoofed: boolean("author_spoofed").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// pending_review waits for a supaadmin second pass; completed is reserved.
// Upcoming/live/ended is computed client-side from starts_at/ends_at.
export const eventStatus = pgEnum("event_status", [
  "draft",
  "pending_review",
  "published",
  "completed",
]);
export const eventGiftKind = pgEnum("event_gift_kind", ["gold", "shop_item"]);
export const eventGiftStatus = pgEnum("event_gift_status", [
  "proposed",
  "approved",
  "denied",
]);
// Null means organizer-added; only "interested" rows get the reminder DM.
export const eventRsvpStatus = pgEnum("event_rsvp_status", [
  "interested",
  "not_interested",
]);
// Lets the RSVP and gift facets coexist on one row without clobbering each other.
export const eventAttendeeSource = pgEnum("event_attendee_source", [
  "self",
  "organizer",
]);

// Any events-access user can edit any event. starts_at is a tz-naive UTC instant; timezone is display-only.
export const eventTable = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    location: text("location"),
    image_url: text("image_url"),
    // When set, the Explore card's "RSVP" links here instead of #macondo; the in-app button is unaffected.
    rsvp_url: text("rsvp_url"),
    starts_at: timestamp("starts_at"),
    ends_at: timestamp("ends_at"),
    timezone: varchar("timezone"),
    status: eventStatus("status").notNull().default("draft"),
    created_by: text("created_by")
      .references(() => users.id)
      .notNull(),
    // Set once, atomically, on first publish; guards against a double broadcast.
    announced_at: timestamp("announced_at"),
    announcement_id: integer("announcement_id").references(
      () => announcementTable.id,
    ),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusStartsIdx: index("events_status_starts_idx").on(
      t.status,
      t.starts_at,
    ),
  }),
);

// One row per (event, user) holding disjoint RSVP and gift facets. An approved gift writes a
// currency_transactions row (gold) or a free shop_orders row (item), linked back here.
export const eventAttendeeTable = pgTable(
  "event_attendees",
  {
    id: serial("id").primaryKey(),
    event_id: integer("event_id")
      .references(() => eventTable.id, { onDelete: "cascade" })
      .notNull(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    is_winner: boolean("is_winner").notNull().default(false),
    added_by: text("added_by").references(() => users.id),

    rsvp_status: eventRsvpStatus("rsvp_status"),
    rsvp_source: eventAttendeeSource("rsvp_source")
      .notNull()
      .default("organizer"),
    rsvp_at: timestamp("rsvp_at"),
    // Claim-before-send dedup for the reminder DM; reset when starts_at changes.
    reminder_sent_at: timestamp("reminder_sent_at"),

    // Certificate unlock gate; only ever set by hand from the internal event editor.
    attended_at: timestamp("attended_at"),
    attendance_marked_by: text("attendance_marked_by").references(
      () => users.id,
    ),

    gift_kind: eventGiftKind("gift_kind"),
    gift_gold_amount: integer("gift_gold_amount"),
    // NO ACTION on delete so an approved gift's item reference stays valid.
    gift_shop_item_id: integer("gift_shop_item_id").references(
      () => shopItemTable.id,
    ),
    gift_status: eventGiftStatus("gift_status"),
    gift_notes: text("gift_notes"),
    gift_proposed_by: text("gift_proposed_by").references(() => users.id),
    gift_proposed_at: timestamp("gift_proposed_at"),
    gift_decided_by: text("gift_decided_by").references(() => users.id),
    gift_decided_at: timestamp("gift_decided_at"),
    gift_decision_reason: text("gift_decision_reason"),
    gift_shop_order_id: integer("gift_shop_order_id").references(
      () => shopOrderTable.id,
    ),
    gift_currency_transaction_id: integer(
      "gift_currency_transaction_id",
    ).references(() => currencyTransactionTable.id),

    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    eventUserUnique: uniqueIndex("event_attendees_event_user_unique").on(
      t.event_id,
      t.user_id,
    ),
    userIdx: index("event_attendees_user_idx").on(t.user_id),
    giftStatusIdx: index("event_attendees_gift_status_idx").on(t.gift_status),
    eventInterestedIdx: index("event_attendees_event_interested_idx").on(
      t.event_id,
      t.rsvp_status,
    ),
    userAttendedIdx: index("event_attendees_user_attended_idx")
      .on(t.user_id)
      .where(sql`${t.attended_at} IS NOT NULL`),
  }),
);

// Source of truth for "has the user already claimed tier X?", preventing double redemption.
export const referralRedemptionsTable = pgTable(
  "referral_redemptions",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tier: integer("tier").notNull(),
    // e.g. "10 gold" or "3 streak freezes + recruiter badge"
    reward_summary: text("reward_summary").notNull(),
    redeemed_at: timestamp("redeemed_at").notNull().defaultNow(),
  },
  (t) => ({
    userTierUnique: uniqueIndex("referral_redemptions_user_tier_unique").on(
      t.user_id,
      t.tier,
    ),
    userIdx: index("referral_redemptions_user_idx").on(t.user_id),
  }),
);

// Capped to one per user per 7 days by server/api/nps/submit.post.ts. Each awards 10 gold
// (source="nps_feedback") so farm abuse can be audited or bulk-reversed.
export const npsResponseTable = pgTable(
  "nps_responses",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    score: integer("score").notNull(),
    doing_well: text("doing_well").notNull(),
    can_improve: text("can_improve").notNull(),
    anything_else: text("anything_else"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    resolved_at: timestamp("resolved_at"),
    resolved_by_user_id: text("resolved_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    airtable_record_id: text("airtable_record_id"),
  },
  (t) => ({
    userCreatedIdx: index("nps_responses_user_created_idx").on(
      t.user_id,
      t.created_at,
    ),
    createdIdx: index("nps_responses_created_idx").on(t.created_at),
  }),
);

// Daily AI summary of NPS feedback + tickets; keyed by date so re-runs replace the day's row.
export const npsInsightsTable = pgTable(
  "nps_insights",
  {
    id: serial("id").primaryKey(),
    generated_for_date: varchar("generated_for_date", { length: 10 })
      .notNull()
      .unique(),
    window_start: timestamp("window_start").notNull(),
    window_end: timestamp("window_end").notNull(),
    response_count: integer("response_count").notNull(),
    ticket_count: integer("ticket_count").notNull().default(0),
    nps_score: numeric("nps_score", {
      precision: 6,
      scale: 2,
      mode: "number",
    }),
    improvements: text("improvements").array().notNull(),
    concerns: text("concerns").array().notNull(),
    positives: text("positives").array().notNull(),
    raw_ai_response: text("raw_ai_response"),
    model: text("model"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
);

// Staff replies go out as spoofed Slack DMs (is_inbound=false); user DM replies are mirrored back
// (is_inbound=true). A conversation's rows share slack_thread_root_ts to stay in one Slack thread.
export const npsResponseRepliesTable = pgTable(
  "nps_response_replies",
  {
    id: serial("id").primaryKey(),
    nps_response_id: integer("nps_response_id")
      .references(() => npsResponseTable.id, { onDelete: "cascade" })
      .notNull(),
    responder_user_id: text("responder_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    is_inbound: boolean("is_inbound").notNull().default(false),
    body: text("body").notNull(),
    slack_message_ts: text("slack_message_ts"),
    slack_channel_id: text("slack_channel_id"),
    slack_thread_root_ts: text("slack_thread_root_ts"),
    slack_error: text("slack_error"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    responseIdx: index("nps_response_replies_response_idx").on(t.nps_response_id),
    // Thread-root lookups and matching inbound DMs to their submission.
    slackTsIdx: index("nps_response_replies_slack_ts_idx").on(t.slack_message_ts),
    threadRootIdx: index("nps_response_replies_thread_root_idx").on(t.slack_thread_root_ts),
  }),
);

// question_es / answer_es fall back to the English copy when null.
export const faqEntrySource = pgEnum("faq_entry_source", [
  "manual",
  "ai_generated",
]);

export const faqEntryTable = pgTable(
  "faq_entries",
  {
    id: serial("id").primaryKey(),
    question_en: text("question_en").notNull(),
    answer_en: text("answer_en").notNull(),
    question_es: text("question_es"),
    answer_es: text("answer_es"),
    source: faqEntrySource("source").notNull().default("manual"),
    sort_order: integer("sort_order").notNull().default(0),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    sortIdx: index("faq_entries_sort_idx").on(t.sort_order),
  }),
);

// AI-generated FAQ candidates; each clusters resolved tickets into one Q&A pair, accepted into faq_entries.
export const faqSuggestionStatus = pgEnum("faq_suggestion_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const faqSuggestionTable = pgTable(
  "faq_suggestions",
  {
    id: serial("id").primaryKey(),
    question_en: text("question_en").notNull(),
    answer_en: text("answer_en").notNull(),
    question_es: text("question_es"),
    answer_es: text("answer_es"),
    status: faqSuggestionStatus("status").notNull().default("pending"),
    source_ticket_count: integer("source_ticket_count").notNull().default(0),
    source_ticket_ids: jsonb("source_ticket_ids")
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reviewed_by_user_id: text("reviewed_by_user_id").references(
      () => users.id,
    ),
    reviewed_at: timestamp("reviewed_at"),
    published_faq_id: integer("published_faq_id").references(
      () => faqEntryTable.id,
      { onDelete: "set null" },
    ),
    raw_ai_response: text("raw_ai_response"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("faq_suggestions_status_idx").on(t.status),
    createdIdx: index("faq_suggestions_created_idx").on(t.created_at),
  }),
);

// Supporter KB: source-cited entries the supporter agent retrieves from (server/lib/support-kb-*.ts).
// Unlike the public faq_entries, every published entry cites at least one kb_sources row.

// archived = hidden but kept for audit and possible resurrection.
export const kbEntryStatus = pgEnum("kb_entry_status", [
  "draft",
  "published",
  "archived",
]);

// source_ref is polymorphic on this: ticket id, "path#anchor", faq id, message id or full url.
export const kbSourceType = pgEnum("kb_source_type", [
  "support_ticket",
  "doc_path",
  "faq_entry",
  "message",
  "external_url",
]);

export const kbSuggestionStatus = pgEnum("kb_suggestion_status", [
  "pending",
  "accepted",
  "rejected",
  "archived",
]);

// body_es falls back to body_en when null; embedding (title + body_en) is set on publish/edit so the
// entry is immediately retrievable. Its HNSW index lives in migration 0155.
export const kbEntryTable = pgTable(
  "kb_entries",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    body_en: text("body_en").notNull(),
    body_es: text("body_es"),
    type: text("type").notNull().default("guide"),
    category: text("category").notNull().default("general"),
    status: kbEntryStatus("status").notNull().default("draft"),
    tags: jsonb("tags")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    valid_from: timestamp("valid_from"),
    valid_until: timestamp("valid_until"),
    last_verified_at: timestamp("last_verified_at"),
    last_verified_by_user_id: text("last_verified_by_user_id").references(
      () => users.id,
    ),
    embedding: vector1536("embedding"),
    sort_order: integer("sort_order").notNull().default(0),
    created_by_user_id: text("created_by_user_id")
      .references(() => users.id)
      .notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("kb_entries_status_idx").on(t.status),
    categoryIdx: index("kb_entries_category_idx").on(t.category),
    sortIdx: index("kb_entries_sort_idx").on(t.sort_order),
    createdIdx: index("kb_entries_created_idx").on(t.created_at),
  }),
);

// citation_text is an immutable snapshot so the cited text survives edits to the original source.
// added_by_user_id is null for pipeline-created rows.
export const kbSourceTable = pgTable(
  "kb_sources",
  {
    id: serial("id").primaryKey(),
    kb_entry_id: integer("kb_entry_id")
      .references(() => kbEntryTable.id, { onDelete: "cascade" })
      .notNull(),
    source_type: kbSourceType("source_type").notNull(),
    source_ref: text("source_ref").notNull(),
    citation_text: text("citation_text").notNull(),
    added_by_user_id: text("added_by_user_id").references(() => users.id),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    entryIdx: index("kb_sources_entry_idx").on(t.kb_entry_id),
    typeIdx: index("kb_sources_type_idx").on(t.source_type),
  }),
);

// KB candidates awaiting human review, never auto-promoted; citations become kb_sources rows on accept.
export const kbSuggestionTable = pgTable(
  "kb_suggestions",
  {
    id: serial("id").primaryKey(),
    question_en: text("question_en").notNull(),
    answer_en: text("answer_en").notNull(),
    question_es: text("question_es"),
    answer_es: text("answer_es"),
    status: kbSuggestionStatus("status").notNull().default("pending"),
    category: text("category").notNull().default("general"),
    source_ticket_count: integer("source_ticket_count").notNull().default(0),
    source_ticket_ids: jsonb("source_ticket_ids")
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    citations: jsonb("citations")
      .$type<{ ticket_id: number; snippet: string }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reviewed_by_user_id: text("reviewed_by_user_id").references(
      () => users.id,
    ),
    reviewed_at: timestamp("reviewed_at"),
    published_kb_id: integer("published_kb_id").references(
      () => kbEntryTable.id,
      { onDelete: "set null" },
    ),
    raw_ai_response: text("raw_ai_response"),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("kb_suggestions_status_idx").on(t.status),
    categoryIdx: index("kb_suggestions_category_idx").on(t.category),
    createdIdx: index("kb_suggestions_created_idx").on(t.created_at),
  }),
);

// Zero-result docs searches, deduped per session client-side. query is lowercased and trimmed so
// variants group together; dismissed_at hides handled rows without losing history.
export const docsSearchMissesTable = pgTable(
  "docs_search_misses",
  {
    id: serial("id").primaryKey(),
    query: text("query").notNull(),
    locale: varchar("locale", { length: 2 }).notNull(),
    user_id: text("user_id").references(() => users.id),
    created_at: timestamp("created_at").notNull().defaultNow(),
    dismissed_at: timestamp("dismissed_at"),
    dismissed_by_user_id: text("dismissed_by_user_id").references(() => users.id),
  },
  (t) => ({
    createdIdx: index("docs_search_misses_created_idx").on(t.created_at),
    queryIdx: index("docs_search_misses_query_idx").on(t.query),
    localeIdx: index("docs_search_misses_locale_idx").on(t.locale),
  }),
);

// value is jsonb so flags can carry richer payloads without a migration; use server/lib/app-settings.ts.
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
  updated_by: text("updated_by").references(() => users.id),
});

// Daily active = (journal_seconds + hackatime_seconds) >= DAILY_ACTIVITY_THRESHOLD_SECONDS for a day.
// hackatime_seconds follows the streak engine's earliest-claim dedupe; compute `day` with streakDayKey.
export const dailyProjectActivityTable = pgTable(
  "daily_project_activity",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    project_id: integer("project_id")
      .references(() => projectTable.id, { onDelete: "cascade" })
      .notNull(),
    day: varchar("day", { length: 10 }).notNull(),
    journal_seconds: integer("journal_seconds").notNull().default(0),
    hackatime_seconds: integer("hackatime_seconds").notNull().default(0),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userProjectDayUniq: uniqueIndex("daily_project_activity_user_project_day_uniq")
      .on(t.user_id, t.project_id, t.day),
    dayIdx: index("daily_project_activity_day_idx").on(t.day),
    userDayIdx: index("daily_project_activity_user_day_idx").on(t.user_id, t.day),
    // The internal project page filters by project_id, which no other index leads with.
    projectIdx: index("daily_project_activity_project_id_idx").on(t.project_id),
  }),
);

// Frozen once captured so later hackatime syncs rewriting history can't change a past day's DAU.
export const dauSnapshotsTable = pgTable("dau_snapshots", {
  day: varchar("day", { length: 10 }).primaryKey(),
  count: integer("count").notNull(),
  captured_at: timestamp("captured_at").notNull().defaultNow(),
});

// `day` is UTC via streakDayKey. `pending` = partial activity; `review_protected` holds a missed day
// without spending a freeze because a ship was in review.
export const streakDayStatusEnum = pgEnum("streak_day_status", [
  "pending",
  "active",
  "frozen",
  "missed",
  "review_protected",
]);

export const streakDaysTable = pgTable(
  "streak_days",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    day: varchar("day", { length: 10 }).notNull(),
    status: streakDayStatusEnum("status").notNull().default("pending"),
    seconds_logged: integer("seconds_logged").notNull().default(0),
    had_journal: boolean("had_journal").notNull().default(false),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userDayUniq: uniqueIndex("streak_days_user_day_uniq").on(t.user_id, t.day),
    userIdx: index("streak_days_user_idx").on(t.user_id),
    dayIdx: index("streak_days_day_idx").on(t.day),
  }),
);

// Each member's own private note; never shown to others.
export const projectNotesTable = pgTable(
  "project_notes",
  {
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    project_id: integer("project_id")
      .references(() => projectTable.id, { onDelete: "cascade" })
      .notNull(),
    note: text("note").notNull().default(""),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.project_id] }),
  }),
);

// Unlocks are permanent even if the stat later drops; definitions live in server/lib/achievements.ts.
export const userAchievementsTable = pgTable(
  "user_achievements",
  {
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    achievement_key: text("achievement_key").notNull(),
    unlocked_at: timestamp("unlocked_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.user_id, t.achievement_key] }),
    userIdx: index("user_achievements_user_idx").on(t.user_id),
  }),
);

// LLM-suggested ideas on /ideas; generation is gated by a 24h cooldown from the latest generated_at.
// project_update ideas point at existing_project_id; SET NULL keeps saved ideas if the project goes.
export const projectIdeaStatus = pgEnum("project_idea_status", [
  "suggested",
  "saved",
  "dismissed",
]);

export const projectIdeaKind = pgEnum("project_idea_kind", [
  "new_project",
  "project_update",
]);

export const projectIdeaTable = pgTable(
  "project_ideas",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    reasoning: text("reasoning"),
    languages: text("languages").array().notNull().default(sql`ARRAY[]::text[]`),
    difficulty: varchar("difficulty", { length: 20 }),
    // Plain varchar so categories can grow without ALTER TYPE; idea-generation.ts validates values.
    category: varchar("category", { length: 16 }).notNull().default("software"),
    // Validated to https-only URLs in idea-generation.ts.
    resources: jsonb("resources")
      .$type<Array<{ title: string; url: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    kind: projectIdeaKind("kind").notNull().default("new_project"),
    existing_project_id: integer("existing_project_id").references(
      () => projectTable.id,
      { onDelete: "set null" },
    ),
    status: projectIdeaStatus("status").notNull().default("suggested"),
    generated_at: timestamp("generated_at").notNull().defaultNow(),
    saved_at: timestamp("saved_at"),
    dismissed_at: timestamp("dismissed_at"),
    // Reserved for linking a saved idea to the project that grew out of it.
    promoted_to_project_id: integer("promoted_to_project_id").references(
      () => projectTable.id,
      { onDelete: "set null" },
    ),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userStatusIdx: index("project_ideas_user_status_idx").on(t.user_id, t.status),
    userGeneratedIdx: index("project_ideas_user_generated_idx").on(t.user_id, t.generated_at),
  }),
);

// Toggling deletes and re-inserts rows; first_upvoted_at lets the notification path suppress repeats.
export const projectUpvotesTable = pgTable(
  "project_upvotes",
  {
    id: serial("id").primaryKey(),
    project_id: integer("project_id")
      .references(() => projectTable.id, { onDelete: "cascade" })
      .notNull(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    first_upvoted_at: timestamp("first_upvoted_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("project_upvotes_unique").on(t.project_id, t.user_id),
    projectIdx: index("project_upvotes_project_idx").on(t.project_id),
    userIdx: index("project_upvotes_user_idx").on(t.user_id),
  }),
);

// recipient_name and hours_at_issue are snapshotted so later edits never alter an issued certificate.
// One active (non-revoked) certificate per user; re-issue after a revoke is allowed.
export const certificatesTable = pgTable(
  "certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: text("user_id")
      .references(() => users.id)
      .notNull(),
    code: varchar("code", { length: 16 }).notNull().unique(),
    hours_at_issue: numeric("hours_at_issue", {
      precision: 10,
      scale: 2,
      mode: "number",
    }).notNull(),
    recipient_name: text("recipient_name").notNull(),
    issued_at: timestamp("issued_at").notNull().defaultNow(),
    revoked_at: timestamp("revoked_at"),
    revoked_reason: text("revoked_reason"),
    issuer_id: text("issuer_id").references(() => users.id),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    oneActivePerUser: uniqueIndex("certificates_one_active_per_user")
      .on(t.user_id)
      .where(sql`${t.revoked_at} IS NULL`),
    userIdx: index("certificates_user_idx").on(t.user_id),
  }),
);

// Supaadmin MCP bearer tokens; only the SHA256 hash is stored. Every request re-checks the supaadmin
// role, so a demotion kills the token on the next call.
export const mcpTokenTable = pgTable(
  "mcp_tokens",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    // SHA256 hex of the raw token; the raw value is never persisted.
    token_hash: text("token_hash").notNull().unique(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    label: text("label").notNull(),
    last4: text("last4").notNull(),
    // Allows the write tools (adjust gold, set roles, resolve tickets); still supaadmin-gated.
    can_write: boolean("can_write").notNull().default(false),
    created_at: timestamp("created_at").notNull().defaultNow(),
    last_used_at: timestamp("last_used_at"),
    expires_at: timestamp("expires_at"),
    revoked_at: timestamp("revoked_at"),
  },
  (t) => ({
    userIdx: index("mcp_tokens_user_id_idx").on(t.user_id),
  }),
);

// One-time codes for the claude.ai MCP connector, bound to PKCE + redirect_uri; hashed at rest, 5-minute expiry.
export const mcpAuthCodeTable = pgTable(
  "mcp_auth_codes",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    code_hash: text("code_hash").notNull().unique(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    can_write: boolean("can_write").notNull().default(false),
    code_challenge: text("code_challenge").notNull(),
    redirect_uri: text("redirect_uri").notNull(),
    expires_at: timestamp("expires_at").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("mcp_auth_codes_user_id_idx").on(t.user_id),
  }),
);

// User-minted read-only (GET/HEAD) keys, gated by the denylist in server/lib/api-keys.ts; only the hash
// persists. No can_write on purpose: future scopes should be a text[] column.
export const apiKeyTable = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    // SHA256 hex of the raw token; the raw value is never persisted.
    token_hash: text("token_hash").notNull().unique(),
    user_id: text("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    label: text("label").notNull(),
    last4: text("last4").notNull(),
    created_at: timestamp("created_at").notNull().defaultNow(),
    last_used_at: timestamp("last_used_at"),
    expires_at: timestamp("expires_at"),
    revoked_at: timestamp("revoked_at"),
  },
  (t) => ({
    userIdx: index("api_keys_user_id_idx").on(t.user_id),
  }),
);

// singular names used by better-auth internals
export const user = users;
export const session = sessions;
