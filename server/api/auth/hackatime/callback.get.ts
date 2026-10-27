import { eq, inArray, sql } from "drizzle-orm";
import db from "~~/server/db";
import {
	users,
	sessions,
	projectTable,
	journalsTable,
	shipTable,
	internalNotesTable,
} from "~~/server/db/schema";
import { mergeUserInto } from "~~/server/lib/account-merge";
import { getSession, createSession, invalidateSessionCache } from "~~/server/lib/session";
import { safeReturnTo } from "~~/server/lib/auth";
import { syncHackatimeTimezone } from "~~/server/lib/hackatime";
import { HACKATIME_URL } from "~~/server/lib/api-urls";

// The existing account wins the hackatime_id and inherits the token; the temp and its data are deleted.
async function adoptExistingAndDeleteTemp(params: {
	tempId: string;
	existingId: string;
	token: string;
}) {
	const { tempId, existingId, token } = params;
	await db.transaction(async (tx) => {
		await tx
			.update(users)
			.set({
				hackatime_oauth_token: token,
				// Reset the dead-token mark so the syncs pick the account back up.
				hackatime_api_status: "ok",
				hackatime_api_status_changed_at: new Date(),
			})
			.where(eq(users.id, existingId));

		const tempProjectIds = (
			await tx
				.select({ id: projectTable.id })
				.from(projectTable)
				.where(eq(projectTable.user_id, tempId))
		).map((p) => p.id);

		if (tempProjectIds.length > 0) {
			await tx.delete(journalsTable).where(inArray(journalsTable.project_id, tempProjectIds));
			await tx.delete(shipTable).where(inArray(shipTable.project_id, tempProjectIds));
			await tx.delete(internalNotesTable).where(inArray(internalNotesTable.project_id, tempProjectIds));
			await tx.delete(projectTable).where(eq(projectTable.user_id, tempId));
		}

		await tx.delete(sessions).where(eq(sessions.userId, tempId));
		await tx.delete(users).where(eq(users.id, tempId));
	});
}

interface HackatimeTokenResponse {
	access_token: string;
	token_type: string;
	scope: string;
	expires_in: number;
	created_at: number;
}

interface HackatimeMeResponse {
	id: number;
}

export default defineEventHandler(async (event) => {
	const query = getQuery(event);
	const code = query.code as string | undefined;
	const state = query.state as string | undefined;
	const error = query.error as string | undefined;

	if (error) {
		return sendRedirect(event, `/onboarding?hackatime=denied&error=${encodeURIComponent(error)}`);
	}

	const storedState = getCookie(event, "hackatime_oauth_state");
	deleteCookie(event, "hackatime_oauth_state", { path: "/" });

	if (!code) {
		throw createError({ statusCode: 400, statusMessage: "Missing authorization code" });
	}

	if (!state || !storedState || state !== storedState) {
		throw createError({ statusCode: 403, statusMessage: "Invalid OAuth state" });
	}

	const user = await getSession(event);
	// getSession just cached the pre-link row under this token; invalidate it after the writes,
	// or /api/auth/me keeps reporting has_hackatime:false until the cache expires.
	const sessionToken = getCookie(event, "macondo_session");

	if (!user) {
		return sendRedirect(event, "/onboarding?error=not_authenticated");
	}

	const config = useRuntimeConfig();
	const hackatimeOAuthClientId =
		config.hackatimeOauthUid as string | undefined;
	const hackatimeOAuthClientSecret =
		(config.hackatimeOauthSecret as string | undefined) ?? undefined;

	const redirectUri = `${getRequestURL(event).origin}/api/auth/hackatime/callback`;

	if (!hackatimeOAuthClientId) {
		throw createError({
			statusCode: 500,
			statusMessage: "Hackatime OAuth is not configured: missing client ID",
		});
	}

	const tokenBody: Record<string, string> = {
		client_id: hackatimeOAuthClientId,
		code,
		redirect_uri: redirectUri,
		grant_type: "authorization_code",
	};

	if (hackatimeOAuthClientSecret) {
		tokenBody.client_secret = hackatimeOAuthClientSecret;
	}

	const tokenRes = await $fetch<HackatimeTokenResponse>(
		`${HACKATIME_URL}/oauth/token`,
		{
			method: "POST",
			body: new URLSearchParams(tokenBody),
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
		},
	);

	if (!tokenRes.access_token) {
		throw createError({ statusCode: 400, statusMessage: "Failed to get Hackatime access token" });
	}

	const me = await $fetch<HackatimeMeResponse>(
		`${HACKATIME_URL}/api/v1/authenticated/me`,
		{ headers: { Authorization: `Bearer ${tokenRes.access_token}` } },
	);

		console.log("[hackatime/callback] token exchanged, me id:", me.id, "session user:", user?.id, "is_temp:", user?.is_temp);

	const existingByHackatime = await db
		.select()
		.from(users)
		.where(eq(users.hackatime_id, me.id))
		.limit(1);

	console.log("[hackatime/callback] existingByHackatime count:", existingByHackatime.length, "existing id:", existingByHackatime[0]?.id, "current user id:", user!.id);

	const existingRow = existingByHackatime[0];
	let connectedUserId = user!.id;

	if (existingRow && existingRow.id !== user!.id) {
		const currentIsTemp = !!user!.is_temp;
		const existingIsTemp = !!existingRow.is_temp;

		if (currentIsTemp && !existingIsTemp) {
			console.log("[hackatime/callback] temp current + real existing: adopt existing", existingRow.id, "drop temp", user!.id);
			await adoptExistingAndDeleteTemp({ tempId: user!.id, existingId: existingRow.id, token: tokenRes.access_token });
			await createSession(event, existingRow.id);
			connectedUserId = existingRow.id;
		} else if (!currentIsTemp && existingIsTemp) {
			console.log("[hackatime/callback] real current + temp existing: claim hackatime_id onto current", user!.id, "migrate from temp", existingRow.id);
			await mergeUserInto({
				sourceId: existingRow.id,
				targetId: user!.id,
				targetPatch: {
					hackatime_id: me.id,
					hackatime_oauth_token: tokenRes.access_token,
					// Clear any dead-token mark (see adopt path above).
					hackatime_api_status: "ok",
					hackatime_api_status_changed_at: new Date(),
				},
			});
		} else if (currentIsTemp && existingIsTemp) {
			console.log("[hackatime/callback] two-temp coalesce: adopt existing", existingRow.id, "drop current temp", user!.id);
			await adoptExistingAndDeleteTemp({ tempId: user!.id, existingId: existingRow.id, token: tokenRes.access_token });
			await createSession(event, existingRow.id);
			connectedUserId = existingRow.id;
		} else {
			console.error("[hackatime/callback] non-temp vs non-temp collision. current:", user!.id, "existing:", existingRow.id);
			throw createError({
				statusCode: 409,
				statusMessage: "This Hackatime account is already linked to a different user. Sign out and sign back in using Hackatime to switch accounts.",
			});
		}
	} else {
		console.log("[hackatime/callback] no-conflict path: updating user", user!.id, "with hackatime_id", me.id);
		const updateResult = await db
			.update(users)
			.set({
				hackatime_id: me.id,
				hackatime_oauth_token: tokenRes.access_token,
				// Clear any dead-token mark (see adopt path above).
				hackatime_api_status: "ok",
				hackatime_api_status_changed_at: new Date(),
			})
			.where(eq(users.id, user!.id))
			.returning({ id: users.id, hackatime_id: users.hackatime_id, hasToken: sql<boolean>`${users.hackatime_oauth_token} IS NOT NULL` });
		console.log("[hackatime/callback] update result:", updateResult);
	}

	// Best-effort; never blocks the redirect.
	void syncHackatimeTimezone({
		userId: connectedUserId,
		hackatimeId: me.id,
		adminKey: (useRuntimeConfig().hackatimeAdminKey as string | undefined) ?? null,
		currentTimezone: null,
		currentHackatimeTimezone: null,
	}).catch((err) => console.error("[hackatime/callback] tz sync failed", err));

	// Drop the stale cached session so /api/auth/me reads the new hackatime token.
	if (sessionToken) invalidateSessionCache(sessionToken);

	const returnTo = safeReturnTo(
		getCookie(event, "auth_return_to"),
		"/onboarding?hackatime=connected",
	);
	deleteCookie(event, "auth_return_to", { path: "/" });
	return sendRedirect(event, returnTo);
});
