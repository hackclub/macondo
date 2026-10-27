import { and, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { useRuntimeConfig } from "#imports";

import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { getUserInfo, refreshAccessToken } from "~~/server/lib/auth";
import { writeAudit } from "~~/server/lib/audit";
import {
  shouldSkipForCooldown,
  type SyncHcaCooldownOpts,
} from "~~/server/lib/hca-cooldown";
import {
  HcaRateLimitedError,
  isDeadRefreshToken,
  isHcaRateLimited,
} from "~~/server/lib/hca-errors";
import { releaseIdentityHold } from "~~/server/lib/identity-hold";
import { upsertPiiLocker } from "~~/server/lib/locker";

export type SyncHcaIdentityOpts = SyncHcaCooldownOpts;

type UserRow = InferSelectModel<typeof users>;

// Test-only injection; production callers don't pass deps.
export type SyncHcaDeps = {
  refreshAccessTokenFn?: typeof refreshAccessToken;
  getUserInfoFn?: typeof getUserInfo;
  applyFn?: (args: ApplyArgs) => Promise<UserRow>;
  now?: () => Date;
};

type ApplyArgs = {
  userId: string;
  prevStatus: string | null;
  identity: Awaited<ReturnType<typeof getUserInfo>>["identity"];
  newRefreshToken: string | null;
};

export async function syncHcaIdentity(
  userId: string,
  opts: SyncHcaIdentityOpts = {},
  deps: SyncHcaDeps = {},
): Promise<UserRow | null> {
  const now = (deps.now ?? (() => new Date()))();

  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  if (!row.hca_refresh_token) return null;

  if (shouldSkipForCooldown(opts, row.hca_last_sync_at ?? null, now)) {
    return row;
  }

  const config = useRuntimeConfig();
  const clientId = config.hackclubAuthClientId as string | undefined;
  const clientSecret = config.hackclubAuthClientSecret as string | undefined;
  if (!clientId || !clientSecret) {
    console.error(
      "[hca/sync] hackclubAuthClientId / Secret missing from runtimeConfig",
      userId,
    );
    return null;
  }

  const refreshFn = deps.refreshAccessTokenFn ?? refreshAccessToken;
  const getInfoFn = deps.getUserInfoFn ?? getUserInfo;

  let tokenRes;
  try {
    tokenRes = await refreshFn(clientId, clientSecret, row.hca_refresh_token);
  } catch (err) {
    if (isHcaRateLimited(err)) throw new HcaRateLimitedError();
    if (isDeadRefreshToken(err)) {
      // Dead for good, so drop it or the resync cron retries it every tick forever; the next login stores a fresh one.
      // Matching the old token keeps a concurrent login's new token intact.
      await db
        .update(users)
        .set({ hca_refresh_token: null })
        .where(and(eq(users.id, userId), eq(users.hca_refresh_token, row.hca_refresh_token)));
      console.warn("[hca/sync] refresh token rejected (invalid_grant), cleared", userId);
      return null;
    }
    // Don't clear the stored token: a transient HCA outage shouldn't log out every user.
    console.error("[hca/sync] refreshAccessToken failed", userId, err);
    return null;
  }

  let info;
  try {
    info = await getInfoFn(tokenRes.access_token);
  } catch (err) {
    console.error("[hca/sync] getUserInfo failed", userId, err);
    return null;
  }

  const { identity } = info;
  const prevStatus = row.hca_verification_status ?? null;

  if (deps.applyFn) {
    return await deps.applyFn({
      userId,
      prevStatus,
      identity,
      newRefreshToken: tokenRes.refresh_token ?? null,
    });
  }

  const [updated] = await db
    .update(users)
    .set({
      hca_verification_status: identity.verification_status ?? null,
      hca_ysws_eligible: identity.ysws_eligible ?? null,
      // HCA may rotate the refresh token; keep the old one when it doesn't.
      hca_refresh_token: tokenRes.refresh_token ?? row.hca_refresh_token,
      hca_last_sync_at: now,
    })
    .where(eq(users.id, userId))
    .returning();

  // Not transactional with the users update; a partial failure recovers on the next sync.
  try {
    await upsertPiiLocker(userId, {
      first_name: identity.first_name,
      last_name: identity.last_name,
      phone_number: identity.phone_number ?? null,
      birthday: identity.birthday ?? null,
      addresses: identity.addresses ?? [],
    });
  } catch (err) {
    console.error("[hca/sync] upsertPiiLocker failed", userId, err);
  }

  const newStatus = identity.verification_status ?? null;

  // Not gated on a status transition, so a hold placed after an earlier verified sync still releases.
  if (newStatus === "verified") {
    try {
      await releaseIdentityHold(userId);
    } catch (err) {
      console.error("[hca/sync] releaseIdentityHold failed", userId, err);
    }
  }

  if (newStatus !== prevStatus) {
    try {
      await writeAudit({
        actor_id: userId,
        action: "hca_status_resynced",
        entity_type: "users",
        entity_id: userId,
        old_value: { hca_verification_status: prevStatus },
        new_value: { hca_verification_status: newStatus },
        sensitive: false,
        change_summary:
          `HCA status changed from ${prevStatus ?? "(null)"} to ${newStatus ?? "(null)"} via syncHcaIdentity`,
      });
    } catch (err) {
      console.error("[hca/sync] writeAudit failed", userId, err);
    }
  }

  return updated ?? null;
}
