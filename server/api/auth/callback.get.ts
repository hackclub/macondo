import { and, eq, ne, or } from "drizzle-orm";
import db from "~~/server/db";
import { users } from "~~/server/db/schema";
import { mergeUserInto } from "~~/server/lib/account-merge";
import { createSession, getSession } from "~~/server/lib/session";
import { fetchSlackHandle, fetchSlackProfile } from "~~/server/lib/slack";
import { exchangeCode, getUserInfo, safeReturnTo } from "~~/server/lib/auth";
import { isHackatimeBanned } from "~~/server/lib/hackatime";
import { releaseIdentityHold } from "~~/server/lib/identity-hold";
import { syncLoopsEvent, type LoopsEvent } from "~~/server/lib/loops";
import { upsertPiiLocker } from "~~/server/lib/locker";
import { autoInviteToMacondoChannel } from "~~/server/lib/macondo-auto-invite";

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const code = query.code as string | undefined;

    if (!code) {
        throw createError({
            statusCode: 400,
            statusMessage: "Oop, something is missing on your request, can you try doing your authentication again?",
        });
    }

    const state = query.state as string | undefined;
    const storedState = getCookie(event, "oauth_state");
    deleteCookie(event, "oauth_state", { path: "/" });

    if (!state || !storedState || state !== storedState) {
        // The state cookie can drop on mobile Safari or expire; retry once before a hard 403.
        if (getCookie(event, "oauth_retry") !== "1") {
            setCookie(event, "oauth_retry", "1", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
                sameSite: "lax",
                path: "/",
                maxAge: 120, // seconds, 2 minutes
            });
            return sendRedirect(event, "/api/auth/login");
        }
        deleteCookie(event, "oauth_retry", { path: "/" });
        throw createError({
            statusCode: 403,
            statusMessage: "Invalid OAuth state",
        });
    }
    deleteCookie(event, "oauth_retry", { path: "/" });

    const config = useRuntimeConfig();
    const redirectUri = `${getRequestURL(event).origin}/api/auth/callback`;
    const clientId = config.hackclubAuthClientId as string | undefined;
    const clientSecret = config.hackclubAuthClientSecret as string | undefined;

    if (!clientId || !clientSecret) {
        throw createError({
            statusCode: 500,
            statusMessage: "Uh oh.. something is not configured on our end, maybe flag us at our help channels?",
        });
    }

    const tokenRes = await exchangeCode(
        clientId,
        clientSecret,
        redirectUri,
        code,
    );

    const { identity } = await getUserInfo(tokenRes.access_token);

    // Fatal HCA rejections are permanent: no session, PII upsert or Loops sync.
    // Recoverable rejections and pending verifications fall through.
    if (
        identity.verification_status === "ineligible" &&
        identity.fatal_rejection === true
    ) {
        deleteCookie(event, "macondo_session", { path: "/" });
        deleteCookie(event, "auth_return_to", { path: "/" });
        const params = new URLSearchParams();
        if (identity.rejection_reason) params.set("reason", identity.rejection_reason);
        if (identity.rejection_reason_details)
            params.set("details", identity.rejection_reason_details);
        return sendRedirect(event, `/auth/rejected?${params.toString()}`, 302);
    }

    let image: string | null = null;
    let slackHandle: string | null = null;
    if (identity.slack_id) {
        const [slackProfile, handle] = await Promise.all([
            fetchSlackProfile(identity.slack_id),
            fetchSlackHandle(identity.slack_id),
        ]);
        image = slackProfile.image;
        slackHandle = handle;
    }

    // username may only hold the Slack @-handle; anything else leaks identifying info.
    // On existing rows null means the lookup failed, so updates must never overwrite with it.
    const username = slackHandle;

    // The legal name (NOT NULL), used for grant/HCB compliance and shipping.
    const legalName =
        [identity.first_name?.trim(), identity.last_name?.trim()]
            .filter((part): part is string => !!part)
            .join(" ") ||
        identity.first_name?.trim() ||
        identity.primary_email;

    // Promote a signed-in temp user's own row so their work stays on the same user id.
    const currentUser = await getSession(event);
    const currentTempUserId = currentUser?.is_temp ? currentUser.id : null;

    let userId: string;
    if (currentTempUserId) {
        // The temp user may already own a real account (same sub or Slack id). Adopt it,
        // since promoting in place would mint a duplicate row.
        const [existingReal] = await db
            .select()
            .from(users)
            .where(
                and(
                    ne(users.id, currentTempUserId),
                    // Adopt only a non-temp account; a later login reconciles temp-only matches.
                    ne(users.is_temp, true),
                    identity.slack_id
                        ? or(
                              eq(users.sub, identity.id),
                              eq(users.slack_id, identity.slack_id),
                          )
                        : eq(users.sub, identity.id),
                ),
            )
            // Oldest row is canonical, matching the by-sub branch below.
            .orderBy(users.createdAt)
            .limit(1);

        if (existingReal) {
            // Move the HCA email over unless a third row owns it; the temp is deleted in the merge.
            const [emailClash] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.email, identity.primary_email))
                .limit(1);
            const emailToSet =
                emailClash &&
                emailClash.id !== existingReal.id &&
                emailClash.id !== currentTempUserId
                    ? undefined
                    : identity.primary_email;

            await mergeUserInto({
                sourceId: currentTempUserId,
                targetId: existingReal.id,
                targetPatch: {
                    sub: identity.id,
                    name: legalName,
                    ...(emailToSet ? { email: emailToSet } : {}),
                    slack_id: identity.slack_id ?? null,
                    // Null means the Slack lookup failed; keep the stored handle/avatar.
                    ...(username ? { username } : {}),
                    ...(image ? { image } : {}),
                    is_temp: false,
                    last_login_at: new Date(),
                    last_seen_at: new Date(),
                    hca_verification_status: identity.verification_status ?? null,
                    hca_ysws_eligible: identity.ysws_eligible ?? null,
                    hca_refresh_token: tokenRes.refresh_token ?? null,
                    hca_last_sync_at: new Date(),
                },
            });

            userId = existingReal.id;
        } else {
            // Keep the temp user's email if another row already owns the HCA email.
            const [emailClash] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.email, identity.primary_email))
                .limit(1);
            const emailToSet =
                emailClash && emailClash.id !== currentTempUserId
                    ? undefined
                    : identity.primary_email;

            await db
                .update(users)
                .set({
                    sub: identity.id,
                    name: legalName,
                    ...(emailToSet ? { email: emailToSet } : {}),
                    slack_id: identity.slack_id ?? null,
                    // Null means the Slack lookup failed; keep the stored handle/avatar.
                    ...(username ? { username } : {}),
                    ...(image ? { image } : {}),
                    is_temp: false,
                    last_login_at: new Date(),
                    last_seen_at: new Date(),
                    hca_verification_status: identity.verification_status ?? null,
                    hca_ysws_eligible: identity.ysws_eligible ?? null,
                    hca_refresh_token: tokenRes.refresh_token ?? null,
                    hca_last_sync_at: new Date(),
                })
                .where(eq(users.id, currentTempUserId));

            userId = currentTempUserId;
        }
    } else {
        // users.sub isn't unique and old bugs left duplicates; take the oldest row as canonical.
        const existingBySub = await db
            .select()
            .from(users)
            .where(eq(users.sub, identity.id))
            .orderBy(users.createdAt)
            .limit(2);

        if (existingBySub.length > 0) {
            // Another row may already own this email (users_email_unique); keep the existing one then.
            const bySubRow = existingBySub[0]!;

            if (existingBySub.length > 1) {
                // Duplicate-sub rows need deduping; log loudly instead of failing.
                console.warn(
                    "[auth/callback] multiple users rows share sub, updating only the oldest",
                    {
                        sub: identity.id,
                        canonicalUserId: bySubRow.id,
                        otherUserIds: existingBySub.slice(1).map((r) => r.id),
                    },
                );
            }

            const [emailClash] = await db
                .select({ id: users.id })
                .from(users)
                .where(eq(users.email, identity.primary_email))
                .limit(1);
            const emailToSet =
                emailClash && emailClash.id !== bySubRow.id
                    ? undefined
                    : identity.primary_email;

            if (!emailToSet) {
                console.warn(
                    "[auth/callback] email clash on bySub update, keeping existing email",
                    {
                        sub: identity.id,
                        bySubUserId: bySubRow.id,
                        clashingUserId: emailClash!.id,
                        attemptedEmail: identity.primary_email,
                    },
                );
            }

            // Scope by id, not sub: duplicate-sub rows would all trip users_email_unique.
            await db
                .update(users)
                .set({
                    ...(emailToSet ? { email: emailToSet } : {}),
                    slack_id: identity.slack_id ?? null,
                    // Null means the Slack lookup failed; keep the stored handle/avatar.
                    ...(username ? { username } : {}),
                    ...(image ? { image } : {}),
                    is_temp: false,
                    last_login_at: new Date(),
                    last_seen_at: new Date(),
                    hca_verification_status: identity.verification_status ?? null,
                    hca_ysws_eligible: identity.ysws_eligible ?? null,
                    hca_refresh_token: tokenRes.refresh_token ?? null,
                    hca_last_sync_at: new Date(),
                })
                .where(eq(users.id, bySubRow.id));

            userId = bySubRow.id;
        } else {
            const existingByEmail = await db
                .select()
                .from(users)
                .where(eq(users.email, identity.primary_email))
                .limit(1);

            if (existingByEmail.length > 0) {
                await db
                    .update(users)
                    .set({
                        sub: identity.id,
                        name: legalName,
                        slack_id: identity.slack_id ?? null,
                        // Null means the Slack lookup failed; keep the stored handle/avatar.
                        ...(username ? { username } : {}),
                        ...(image ? { image } : {}),
                        is_temp: false,
                        last_login_at: new Date(),
                        last_seen_at: new Date(),
                        hca_verification_status: identity.verification_status ?? null,
                        hca_ysws_eligible: identity.ysws_eligible ?? null,
                        hca_refresh_token: tokenRes.refresh_token ?? null,
                        hca_last_sync_at: new Date(),
                    })
                    .where(eq(users.id, existingByEmail[0]!.id));

                userId = existingByEmail[0]!.id;
            } else {
                // Sign-ups are closed: only people who already have a Macondo account may sign in.
                deleteCookie(event, "auth_return_to", { path: "/" });
                return sendRedirect(event, "/auth/rejected?closed=1", 302);
            }
        }
    }


    // Before createSession and Loops/PII side effects, so banned users never get a session.
    const [userRow] = await db
        .select({
            hackatime_id: users.hackatime_id,
            hackatime_oauth_token: users.hackatime_oauth_token,
            email: users.email,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
    if (userRow) {
        if (await isHackatimeBanned({
            adminKey: (config.hackatimeAdminKey as string | undefined) ?? null,
            hackatimeId: userRow.hackatime_id ?? null,
            hackatimeOAuthToken: userRow.hackatime_oauth_token ?? null,
            email: userRow.email ?? identity.primary_email,
            userId,
        })) {
            deleteCookie(event, "macondo_session", { path: "/" });
            deleteCookie(event, "auth_return_to", { path: "/" });
            return sendRedirect(event, "https://fraud.hackclub.com", 302);
        }
    }

    await createSession(event, userId);

    // Needs the `address` scope (see login.get.ts); the airtable ship sync relies on it.
    try {
      await upsertPiiLocker(userId, {
        first_name: identity.first_name,
        last_name: identity.last_name,
        phone_number: identity.phone_number ?? null,
        birthday: identity.birthday ?? null,
        addresses: identity.addresses ?? [],
      });
    } catch (e) {
      console.error("Failed to upsert pii_locker for user", userId, e);
    }

    // Idempotent; failure never breaks sign-in.
    if (identity.verification_status === "verified") {
      void releaseIdentityHold(userId).catch((e) => {
        console.error("[auth/callback] releaseIdentityHold failed", userId, e);
      });
    }

    // Runs once per user (slack_macondo_auto_invited_at) and never throws.
    void autoInviteToMacondoChannel(userId).catch((e) => {
      console.error("[auth/callback] auto-invite to #macondo failed", userId, e);
    });

    // Runs on every sign-in so Airtable has the latest auth-finished timestamp.
    void syncLoopsEvent({
      email: identity.primary_email,
      slack_id: identity.slack_id ?? null,
      first_name: identity.first_name ?? null,
      last_name: identity.last_name ?? null,
      event: "macondoAuthFinished",
      user_id: userId,
    });

    // ineligible never reaches here (fatal rejections redirect earlier), so no "rejected" event.
    const hcaEvent: LoopsEvent | null =
      identity.verification_status === "verified"
        ? "macondoHcaVerified"
        : identity.verification_status === "pending"
          ? "macondoHcaPending"
          : identity.verification_status === "basic_info_required"
            ? "macondoHcaBasicInfoRequired"
            : identity.verification_status === "document_required"
              ? "macondoHcaDocumentRequired"
              : null;
    if (hcaEvent) {
      void syncLoopsEvent({
        email: identity.primary_email,
        slack_id: identity.slack_id ?? null,
        first_name: identity.first_name ?? null,
        last_name: identity.last_name ?? null,
        event: hcaEvent,
        user_id: userId,
      });
    }

    const returnTo = safeReturnTo(
        getCookie(event, "auth_return_to"),
        "/dashboard?from=auth",
    );
    deleteCookie(event, "auth_return_to", { path: "/" });
    return sendRedirect(event, returnTo);
});
