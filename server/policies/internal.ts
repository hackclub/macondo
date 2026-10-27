import type { users } from "../db/schema";

const INTERNAL_ACCESS_ROLES = [
  "supaadmin",
  "admin",
  "fraudster",
  "software_reviewer",
  "hardware_reviewer",
  "fulfiller",
  "hq",
  "support",
  "events",
];

const INTERNAL_REVIEW_ROLES = [
  "supaadmin",
  "admin",
  "fraudster",
  "software_reviewer",
  "hardware_reviewer",
  "hq",
];

// software_reviewer / hardware_reviewer are layered on top for single-type specialists.
const FULL_SPECTRUM_REVIEW_ROLES = [
  "supaadmin",
  "admin",
  "fraudster",
  "hq",
];

const INTERNAL_USER_ROLES = [
  "supaadmin",
  "admin",
  "fraudster",
  "hq",
];

const INTERNAL_ORDER_ROLES = [
  "supaadmin",
  "fulfiller",
  "hq",
];

// fulfiller is deliberately absent: it only sees isOrderVisibleToFulfiller orders (policies/shop.ts).
const INTERNAL_ORDER_FULL_VIEW_ROLES = [
  "supaadmin",
  "hq",
];

const INTERNAL_SHOP_ADMIN_ROLES = [
  "supaadmin",
];

const INTERNAL_STATS_ROLES = [
  "supaadmin",
  "admin",
];

const INTERNAL_SUPPORT_ROLES = [
  "supaadmin",
  "admin",
  "hq",
  "software_reviewer",
  "hardware_reviewer",
  "support",
];

const INTERNAL_FAQ_ADMIN_ROLES = [
  "supaadmin",
  "admin",
];

const INTERNAL_SHIPPED_PROJECTS_ROLES = [
  "supaadmin",
];

const INTERNAL_CERTIFICATES_ADMIN_ROLES = [
  "supaadmin",
];

const INTERNAL_NOTIFICATIONS_ADMIN_ROLES = [
  "supaadmin",
  "admin",
];

// supaadmin-only because a broadcast reaches every signed-in user at once
const INTERNAL_ANNOUNCEMENTS_ADMIN_ROLES = [
  "supaadmin",
];

const INTERNAL_IMPERSONATION_ROLES = [
  "supaadmin",
  "admin",
];

const INTERNAL_EVENTS_ROLES = [
  "supaadmin",
  "admin",
  "events",
];

export function hasRole(actor: typeof users.$inferSelect, roles: string[]): boolean {
  return (actor.roles ?? []).some((r) => roles.includes(r));
}

export function canAccess(actor: typeof users.$inferSelect): boolean {
  return hasRole(actor, INTERNAL_ACCESS_ROLES);
}

export function canAccessInternalEvents(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_EVENTS_ROLES);
}

// Gift decisions move real gold or mint free orders, so they're tighter than the events role.
export function canDecideEventGifts(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, ["supaadmin"]);
}

export function canAccessInternalReview(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_REVIEW_ROLES);
}

export function canAccessInternalOrders(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_ORDER_ROLES);
}

// Others with order access are scoped to isOrderVisibleToFulfiller (policies/shop.ts).
export function canViewAllOrders(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_ORDER_FULL_VIEW_ROLES);
}

export function canAccessInternalShopAdmin(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_SHOP_ADMIN_ROLES);
}

export function canAccessInternalUsers(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_USER_ROLES);
}

export function canAccessInternalStats(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_STATS_ROLES);
}

export function canAccessInternalSupport(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_SUPPORT_ROLES);
}

export function canManageInternalFAQ(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_FAQ_ADMIN_ROLES);
}

// Wider than the FAQ admin gate because curating the KB is part of support work.
export function canManageSupporterKB(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_SUPPORT_ROLES);
}

export function canAccessInternalShippedProjects(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_SHIPPED_PROJECTS_ROLES);
}

// Public certificate, verify, and claim surfaces live outside /api/internal and aren't gated here.
export function canAccessInternalCertificates(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_CERTIFICATES_ADMIN_ROLES);
}

// Support-only staff are walled to /internal/support, away from PII and project data.
export function isSupportOnly(
  actor: typeof users.$inferSelect,
): boolean {
  const roles = actor.roles ?? [];
  if (!roles.includes("support")) return false;
  return !roles.some(
    (r) => r !== "support" && INTERNAL_ACCESS_ROLES.includes(r),
  );
}

export function canAccessNotificationAdmin(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_NOTIFICATIONS_ADMIN_ROLES);
}

export function canManageAnnouncements(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_ANNOUNCEMENTS_ADMIN_ROLES);
}

// MCP tokens act with supaadmin scope; the MCP path re-checks this role on every call,
// so a demoted owner's tokens stop working immediately.
export function canManageMcpTokens(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, ["supaadmin"]);
}

export function canStartImpersonation(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, INTERNAL_IMPERSONATION_ROLES);
}

export function canAccessInternalPath(
  actor: typeof users.$inferSelect,
  path: string,
): boolean {
  // me renders the navbar; reauth/verify must stay open or the client can't enter the section.
  if (isSupportOnly(actor)) {
    return (
      path === "/api/internal/me" ||
      path === "/api/internal/search" ||
      path === "/internal/verify" ||
      path.startsWith("/api/internal/reauth") ||
      path.startsWith("/internal/support") ||
      path.startsWith("/api/internal/support") ||
      path.startsWith("/internal/kb-") ||
      path.startsWith("/api/internal/kb-")
    );
  }

  if (
    path.startsWith("/internal/mcp") ||
    path.startsWith("/api/internal/mcp")
  ) {
    return canManageMcpTokens(actor);
  }

  if (
    path.startsWith("/internal/shipped") ||
    path.startsWith("/api/internal/shipped")
  ) {
    return canAccessInternalShippedProjects(actor);
  }

  if (
    path.startsWith("/internal/certificates") ||
    path.startsWith("/api/internal/certificates")
  ) {
    return canAccessInternalCertificates(actor);
  }

  if (
    path.startsWith("/internal/shop") ||
    path.startsWith("/internal/hcb") ||
    path.startsWith("/api/internal/shop/items") ||
    path.startsWith("/api/internal/shop/synthetic") ||
    path.startsWith("/api/internal/shop-requests") ||
    path.startsWith("/api/internal/hcb")
  ) {
    return canAccessInternalShopAdmin(actor);
  }

  if (
    path.startsWith("/internal/orders") ||
    path.startsWith("/api/internal/shop/orders")
  ) {
    return canAccessInternalOrders(actor);
  }

  // Must precede the broader /internal/users branch.
  if (
    path.startsWith("/internal/users/backups") ||
    path.startsWith("/api/internal/users/backups")
  ) {
    return canAccessInternalBackups(actor);
  }

  if (
    path.startsWith("/internal/users") ||
    path.startsWith("/api/internal/users")
  ) {
    return canAccessInternalUsers(actor);
  }

  if (
    path.startsWith("/internal/stats") ||
    path.startsWith("/api/internal/stats") ||
    path.startsWith("/internal/event-progress") ||
    path.startsWith("/api/internal/event-progress")
  ) {
    return canAccessInternalStats(actor);
  }

  if (
    path.startsWith("/internal/support") ||
    path.startsWith("/api/internal/support")
  ) {
    return canAccessInternalSupport(actor);
  }

  if (
    path.startsWith("/internal/faq-suggestions") ||
    path.startsWith("/api/internal/faq-suggestions") ||
    path.startsWith("/api/internal/faq-entries") ||
    path.startsWith("/internal/docs-misses") ||
    path.startsWith("/api/internal/docs-misses")
  ) {
    return canManageInternalFAQ(actor);
  }

  if (
    path.startsWith("/internal/kb-suggestions") ||
    path.startsWith("/api/internal/kb-suggestions") ||
    path.startsWith("/internal/kb-entries") ||
    path.startsWith("/api/internal/kb-entries")
  ) {
    return canManageSupporterKB(actor);
  }

  if (
    path.startsWith("/internal/notifications") ||
    path.startsWith("/api/internal/notifications")
  ) {
    return canAccessNotificationAdmin(actor);
  }

  if (
    path.startsWith("/internal/announcements") ||
    path.startsWith("/api/internal/announcements")
  ) {
    return canManageAnnouncements(actor);
  }

  // Gift decision endpoints under this prefix re-check canDecideEventGifts in-handler.
  if (
    path.startsWith("/internal/events") ||
    path.startsWith("/api/internal/events")
  ) {
    return canAccessInternalEvents(actor);
  }

  // Explicit branches for previously catch-all prefixes, so a future handler
  // that relies on middleware alone inherits least privilege, not all-roles.
  if (
    path.startsWith("/internal/nps") ||
    path.startsWith("/api/internal/nps") ||
    path.startsWith("/internal/analytics") ||
    path.startsWith("/api/internal/analytics")
  ) {
    return canAccessInternalStats(actor);
  }

  // Grants move real gold and mint free orders: supaadmin only (handlers re-check).
  if (
    path.startsWith("/internal/grants") ||
    path.startsWith("/api/internal/grants")
  ) {
    return canAccessInternalShopAdmin(actor);
  }

  // Ops jobs (hackatime sync, DAU snapshots, streak backfills): supaadmin only.
  if (
    path.startsWith("/internal/jobs") ||
    path.startsWith("/api/internal/jobs")
  ) {
    return hasRole(actor, ["supaadmin"]);
  }

  // Cron endpoints stay session-gated (auth.ts) and each handler enforces its
  // own role check; any internal role may reach them.
  if (
    path.startsWith("/internal/cron") ||
    path.startsWith("/api/internal/cron")
  ) {
    return canAccess(actor);
  }

  if (
    path.startsWith("/internal/projects") ||
    path.startsWith("/api/internal/projects") ||
    path.startsWith("/api/internal/journals") ||
    path.startsWith("/api/internal/ships")
  ) {
    return canAccessInternalReview(actor);
  }

  return canAccess(actor);
}

export function canViewUser(
  actor: typeof users.$inferSelect,
  target: typeof users.$inferSelect,
): boolean {
  if (actor.id === target.id && !hasRole(actor, ["supaadmin"])) return false;
  return canAccessInternalUsers(actor);
}

export function canManageInternalNotes(
  actor: typeof users.$inferSelect,
): boolean {
  return canAccessInternalUsers(actor);
}

export function canImpersonateUser(
  actor: typeof users.$inferSelect,
  target: typeof users.$inferSelect,
): boolean {
  if (actor.id === target.id) return false;
  if (!canStartImpersonation(actor)) return false;

  if (hasRole(actor, ["supaadmin"])) return true;

  // Admins can't impersonate staff, or they'd inherit permissions they don't hold.
  if (hasRole(target, INTERNAL_ACCESS_ROLES)) return false;

  return true;
}

// Self-nuke is deliberately allowed.
export function canNukeUser(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, ["supaadmin"]);
}

export function canBanUser(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, ["supaadmin"]);
}

// Same gate as canNukeUser since backups operate on the nuke audit log.
export function canAccessInternalBackups(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, ["supaadmin"]);
}

export function canAdjustUserGold(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, ["supaadmin", "admin", "hq"]);
}

// For makers who can't build (e.g. can't afford a PCB); moves real gold like an approval.
export function canFulfillPendingGold(
  actor: typeof users.$inferSelect,
): boolean {
  return hasRole(actor, ["supaadmin"]);
}

export function isAbleToReview(actor: typeof users.$inferSelect): boolean {
  return canAccessInternalReview(actor);
}

// Conflict of interest; supaadmins keep the bypass to clean up orphaned ships.
export function canReviewOwnProjects(actor: typeof users.$inferSelect): boolean {
  return hasRole(actor, ["supaadmin"]);
}

export type ReviewableProjectType = "software" | "hardware";

export function getReviewableProjectTypes(
  actor: typeof users.$inferSelect,
): ReviewableProjectType[] {
  if (hasRole(actor, FULL_SPECTRUM_REVIEW_ROLES)) {
    return ["software", "hardware"];
  }
  const types = new Set<ReviewableProjectType>();
  const actorRoles = actor.roles ?? [];
  if (actorRoles.includes("software_reviewer")) types.add("software");
  if (actorRoles.includes("hardware_reviewer")) types.add("hardware");
  return Array.from(types);
}

// A null project type means any reviewer can act, so legacy rows aren't stranded.
export function canReviewShipType(
  actor: typeof users.$inferSelect,
  projectType: "software" | "hardware" | null | undefined,
): boolean {
  if (!isAbleToReview(actor)) return false;
  if (!projectType) return true;
  return getReviewableProjectTypes(actor).includes(projectType);
}

export function isAbleToHandlePII(actor: typeof users.$inferSelect): boolean {
  return hasRole(actor, ["supaadmin", "admin", "fulfiller", "hq"]);
}

// invite_code is a bearer capability granting write access, so it must never ride along.
// Handlers should pass project rows through this instead of spreading them.
export function redactProjectForInternal<T extends Record<string, unknown>>(
  project: T | null | undefined,
):
  | Omit<T, "invite_code" | "html_content" | "css_content" | "readme_content">
  | null {
  if (!project) return null;
  const {
    invite_code: _inviteCode,
    html_content: _htmlContent,
    css_content: _cssContent,
    readme_content: _readmeContent,
    ...rest
  } = project;
  return rest as Omit<
    T,
    "invite_code" | "html_content" | "css_content" | "readme_content"
  >;
}

