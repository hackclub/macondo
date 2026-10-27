import { eq } from "drizzle-orm";
import db, { sql as rawSql } from "~~/server/db";
import { piiLockerTable } from "~~/server/db/schema";
import { destroySession, getImpersonatorSession, getSession } from "~~/server/lib/session";
import { computeDashboardStreak, reconcileFreezesIfStale, streakDayKey, userQualifiedAnyProjectToday } from "~~/server/lib/streaks";
import { isHackatimeBannedCached } from "~~/server/lib/hackatime";
import { getActiveMacondoBan } from "~~/server/lib/macondo-ban";
import { getDevDebugFlags, isDevDebugAvailable } from "~~/server/lib/dev-debug-flags";
import { isCompleteShippingAddress, isPlausibleRealName, pickPrimaryAddress } from "~~/server/lib/locker";
import { getShipDeadlineMs } from "~~/server/lib/ship-deadline";

export default defineEventHandler(async (event) => {
  // Server-Timing breakdown (DevTools > Network > Timing). db-ping is a bare SELECT 1 run
  // alongside the session lookup: slow ping = network/connection cost, fast ping but slow
  // steps = pool waits or slow queries.
  const startedAt = performance.now();
  const timings: string[] = [];
  const timed = <T>(name: string, promise: Promise<T>): Promise<T> => {
    const begin = performance.now();
    return promise.finally(() => {
      timings.push(`${name};dur=${(performance.now() - begin).toFixed(1)}`);
    });
  };
  const flushTimings = () => {
    timings.push(`total;dur=${(performance.now() - startedAt).toFixed(1)}`);
    setResponseHeader(event, "Server-Timing", timings.join(", "));
  };

  const [user] = await Promise.all([
    timed("session", getSession(event)),
    timed("db-ping", Promise.resolve(rawSql`select 1`).catch(() => undefined)),
  ]);

  if (!user) {
    flushTimings();
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const devDebugFlags = getDevDebugFlags(event);
  const config = useRuntimeConfig();
  // Local-day key in the user's timezone, matching streak_days.day and projects.last_worked_date.
  const today = streakDayKey(new Date(), user.timezone);

  type LockerAddress = {
    id?: string | null;
    line_1?: string | null;
    line_2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    country?: string | null;
    primary?: boolean | null;
  };

  // Independent lookups run together: run back to back, their DB and network round trips
  // stacked into multi-second responses on every page load.
  const [
    impersonator,
    banned,
    macondoBan,
    streakFreezesRemaining,
    streak,
    locker,
    shipDeadlineMs,
  ] = await Promise.all([
    timed("impersonation", getImpersonatorSession(event)),
    // Fail open: this runs on every authenticated page, so a lookup failure counts as not banned.
    timed("hackatime-ban", isHackatimeBannedCached({
      adminKey: (config.hackatimeAdminKey as string | undefined) ?? null,
      hackatimeId: user.hackatime_id ?? null,
      hackatimeOAuthToken: user.hackatime_oauth_token ?? null,
      email: user.email ?? null,
      userId: user.id,
    }).catch((err) => {
      console.error("[auth/me] isHackatimeBanned lookup failed", err);
      return false;
    })),
    // Fail open on lookup failures.
    timed("macondo-ban", getActiveMacondoBan(user.id).catch((err) => {
      console.error("[auth/me] getActiveMacondoBan lookup failed", err);
      return null;
    })),
    timed("freezes", reconcileFreezesIfStale(user.id)
      .then((r) => r.streak_freezes_remaining)
      .catch((err) => {
        console.error("[auth/me] reconcileFreezesIfStale failed", err);
        return user.streak_freezes_remaining ?? 0;
      })),
    timed("streak", (async () => {
      let workedToday = false;
      try {
        workedToday = await userQualifiedAnyProjectToday(user.id, today);
      } catch (err) {
        console.error("[auth/me] userQualifiedAnyProjectToday failed", err);
      }
      // Shared with /api/profile/streaks via computeDashboardStreak so the HUD and profile always agree.
      let longestCurrentStreak = 0;
      try {
        // workedToday makes a qualified day count immediately instead of lagging until the next sync.
        longestCurrentStreak = await computeDashboardStreak(user.id, user.timezone, workedToday);
      } catch (err) {
        console.error("[auth/me] current streak lookup failed", err);
      }
      return { workedToday, longestCurrentStreak };
    })()),
    timed("locker", db
      .select({
        addresses: piiLockerTable.addresses,
        first_name: piiLockerTable.first_name,
        last_name: piiLockerTable.last_name,
      })
      .from(piiLockerTable)
      .where(eq(piiLockerTable.user_id, user.id))
      .limit(1)
      .then((rows) => rows[0] ?? null)
      .catch((err) => {
        console.error("[auth/me] addresses lookup failed", err);
        return null;
      })),
    timed("ship-deadline", getShipDeadlineMs(user)),
  ]);
  flushTimings();

  if (banned) {
    await destroySession(event);
    throw createError({
      statusCode: 401,
      statusMessage: "banned",
      data: { banned: true, redirect: "https://fraud.hackclub.com" },
    });
  }

  // Unlike the Hackatime ban, keep the session: /banned re-reads this endpoint to show the reason.
  if (macondoBan) {
    throw createError({
      statusCode: 401,
      statusMessage: "banned",
      data: {
        banned: true,
        scope: "macondo",
        reason: macondoBan.reason,
        until: macondoBan.expires_at
          ? macondoBan.expires_at.toISOString()
          : null,
      },
    });
  }

  const { workedToday, longestCurrentStreak } = streak;
  const addresses: LockerAddress[] =
    locker?.addresses && Array.isArray(locker.addresses)
      ? (locker.addresses as LockerAddress[])
      : [];
  const lockerFirstName: string | null = locker?.first_name ?? null;
  const lockerLastName: string | null = locker?.last_name ?? null;
  const effectiveHasAddress = addresses.length > 0 || devDebugFlags.ignoreAddressChecks;

  // Name is resolved like the Airtable sync does (locker first/last, else split users.name).
  const [firstFromName = "", ...restFromName] = (user.name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const resolvedFirstName = lockerFirstName?.trim() || firstFromName;
  const resolvedLastName = lockerLastName?.trim() || restFromName.join(" ");

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
    created_at: user.createdAt ?? null,
    username: user.username,
    slack_id: user.slack_id,
    locale: user.locale,
    timezone: user.timezone,
    roles: user.roles,
    onboarding_step: user.onboarding_step,
    is_temp: user.is_temp,
    has_hackclub: !!user.sub,
    has_github: !!user.github_token,
    has_hackatime: !!user.hackatime_oauth_token || devDebugFlags.fakeHackatime,
    // Only for revoked tokens; 'api_restricted' users can't be helped by reconnecting.
    hackatime_token_invalid: user.hackatime_api_status === "invalid_token",
    completed_guides: user.completed_guides || [],
    streak_freezes_remaining: streakFreezesRemaining,
    worked_today: workedToday,
    longest_current_streak: longestCurrentStreak,
    reminder_hours_before_day_end: user.reminder_hours_before_day_end ?? 1,
    reminder_local_hours: user.reminder_local_hours ?? null,
    streak_slack_notifications: user.streak_slack_notifications ?? true,
    auto_use_streak_freezes: user.auto_use_streak_freezes ?? true,
    has_address: effectiveHasAddress,
    // has_address stays a presence check for backward compatibility.
    has_valid_address:
      effectiveHasAddress &&
      (devDebugFlags.ignoreAddressChecks ||
        isCompleteShippingAddress(pickPrimaryAddress(addresses))),
    has_valid_name:
      devDebugFlags.ignoreAddressChecks ||
      isPlausibleRealName(resolvedFirstName, resolvedLastName),
    // API keys never get PII locker contents.
    addresses: event.context.apiKeyAuth ? [] : addresses,
    dev_debug_flags: isDevDebugAvailable() ? devDebugFlags : null,
    // Never add hca_refresh_token or hca_last_sync_at here; they are server-only.
    hca_verification_status: user.hca_verification_status ?? null,
    hca_ysws_eligible: user.hca_ysws_eligible ?? null,
    // Epoch ms when shipping closes for this user (global or extension deadline).
    ship_deadline_ms: shipDeadlineMs,
    ship_grace_submit_available: user.post_deadline_ship_used_at == null,
    last_login_at: user.last_login_at ?? null,
    impersonation: impersonator
      ? {
          actor: {
            id: impersonator.id,
            name: impersonator.name,
            username: impersonator.username,
            email: impersonator.email,
            image: impersonator.image,
          },
        }
      : null,
  };
});
