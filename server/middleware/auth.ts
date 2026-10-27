import { getSession } from "../lib/session";
import { isValidCronToken } from "../lib/cron-token";
import {
    getInternalReauthRedirect,
    getInternalReauthStatus,
    requiresInternalReauth,
} from "../lib/internal-reauth";
import { getRoutedPath } from "../lib/request-path";
import * as internalPolicies from "../policies/internal";

// Paths here skip the session gates; each endpoint must validate x-cron-token itself.
const CRON_TOKEN_ALLOWLIST: ReadonlySet<string> = new Set([
    "/api/internal/cron/backfill-ari-justification",
    "/api/internal/cron/apply-fluster-decisions",
    "/api/internal/cron/repair-fluster-group-splits",
]);

export default defineEventHandler(async (event) => {
    const url = getRequestURL(event);
    // Gate on the decoded routed path so percent-encoded paths (/api/interna%6C) can't bypass it.
    const path = getRoutedPath(event);

    const isLanding = path === "/";
    const isWeb = path.startsWith("/internal");
    const isApi = path.startsWith("/api/internal");

    if (!isLanding && !isApi && !isWeb) return;

    if (isLanding) {
        if (await getSession(event)) return sendRedirect(event, "/dashboard");
        return;
    }

    // Personal API keys must never authenticate staff surfaces, even if the
    // api-keys.ts denylist changes.
    delete event.context.apiKeyAuth;

    if (isApi && CRON_TOKEN_ALLOWLIST.has(path)) {
        // Timing-safe: this header is an admin-equivalent bearer on this path.
        if (isValidCronToken(event)) {
            return;
        }
    }

    const user = await getSession(event);

    if (!user) {
        if (isApi) {
            throw createError({ statusCode: 401, statusMessage: "Unauthorized" });
        }
        return sendRedirect(event, "/");
    }

    if (!internalPolicies.canAccess(user)) {
        if (isApi) {
            throw createError({ statusCode: 403, statusMessage: "Forbidden" });
        }
        return sendRedirect(event, "/");
    }

    if (!internalPolicies.canAccessInternalPath(user, path)) {
        if (isApi) {
            throw createError({ statusCode: 403, statusMessage: "Forbidden" });
        }
        return sendRedirect(
            event,
            internalPolicies.isSupportOnly(user)
                ? "/internal/support"
                : "/internal/dashboard",
        );
    }

    event.context.user = user;

    if (!requiresInternalReauth(path)) {
        return;
    }

    if (getInternalReauthStatus(event, user.id).verified) {
        return;
    }

    if (isApi) {
        throw createError({
            statusCode: 401,
            statusMessage: "Internal reauthentication required",
        });
    }

    return sendRedirect(event, getInternalReauthRedirect(`${url.pathname}${url.search}`));
});
