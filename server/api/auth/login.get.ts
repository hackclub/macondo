import { randomBytes } from "node:crypto";
import { getAuthorizationUrl, HACK_CLUB_AUTH_SCOPES, safeReturnTo } from "~~/server/lib/auth";

const OAUTH_STATE_TTL_SECONDS = 1800;

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const clientId = config.hackclubAuthClientId as string | undefined;

    if (!clientId) {
        throw createError({
            statusCode: 500,
            statusMessage: "Hack Club Auth is not configured. Missing client ID.",
        });
    }

    // Validate here so a hostile `?return_to=https://evil.com` never gets persisted.
    const returnTo = safeReturnTo(getQuery(event).return_to as string | undefined, "");
    if (returnTo) {
        setCookie(event, "auth_return_to", returnTo, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
            sameSite: "lax",
            path: "/",
            maxAge: OAUTH_STATE_TTL_SECONDS,
        });
    }

    const state = randomBytes(32).toString("base64url");
    setCookie(event, "oauth_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: OAUTH_STATE_TTL_SECONDS,
    });

    // Without the address scope identity.addresses is null and ship fulfillment breaks.
    const authorizationUrl = getAuthorizationUrl(
        clientId,
        `${getRequestURL(event).origin}/api/auth/callback`,
        {
            scopes: [HACK_CLUB_AUTH_SCOPES.basicInfo, HACK_CLUB_AUTH_SCOPES.address],
        },
    );

    const urlWithState = new URL(authorizationUrl);
    urlWithState.searchParams.set("state", state);

    return sendRedirect(event, urlWithState.toString());
});
