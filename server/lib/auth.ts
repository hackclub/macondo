import { $fetch } from "ofetch";
import { HACK_CLUB_AUTH_URL } from "./api-urls";

export const HACK_CLUB_AUTH_SCOPES = {
    basicInfo: "basic_info",
    address: "address",
} as const;

// Same-origin relative paths only, so a post-OAuth user can't land on a hostile origin (incl. `//evil.com`).
export function safeReturnTo(candidate: string | undefined | null, fallback: string) {
    if (typeof candidate !== "string" || !candidate.startsWith("/")) return fallback;
    // Browsers normalize backslashes and strip ASCII controls in special URLs.
    // `/\\evil.example` and `/\t/evil.example` can therefore become external redirects.
    if (candidate.startsWith("//") || candidate.includes("\\") || [...candidate].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return fallback;
    return candidate;
}

export interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    scope: string;
}

// Anything but "verified" counts as non-verified, matching the strict checks in the referral,
// ship, shop and grant gates.
export type HcaVerificationStatus =
    | "verified"
    | "pending"
    | "basic_info_required"
    | "document_required"
    | "needs_submission"
    | "ineligible"
    | string;

export interface UserInfo {
    identity: {
        id: string;
        primary_email: string;
        first_name?: string;
        last_name?: string;
        slack_id?: string;
        phone_number?: string | null;
        // ISO date (YYYY-MM-DD) with the basic_info scope.
        birthday?: string | null;
        // ineligible + fatal_rejection is permanent (refuse the session); non-fatal can re-submit.
        // pending users are let in, with shop/grants locked until verified.
        verification_status?: HcaVerificationStatus | null;
        fatal_rejection?: boolean | null;
        rejection_reason?: string | null;
        rejection_reason_details?: string | null;
        ysws_eligible?: boolean | null;
        addresses?: {
            id: string;
            first_name?: string;
            last_name?: string;
            line_1?: string;
            line_2?: string | null;
            city?: string;
            state?: string | null;
            postal_code?: string;
            country?: string;
            phone_number?: string | null;
            primary?: boolean;
        }[];
    };
    scopes?: string[];
}

export function getAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    options?: {
        scopes?: string[];
        prompt?: "login";
    },
) {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: (options?.scopes?.length
            ? options.scopes
            : [HACK_CLUB_AUTH_SCOPES.basicInfo]
        ).join(" "),
    });

    if (options?.prompt) {
        params.set("prompt", options.prompt);
    }

    return `${HACK_CLUB_AUTH_URL}/oauth/authorize?${params.toString()}`;
}

export async function exchangeCode(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    code: string,
): Promise<TokenResponse> {
    return await $fetch<TokenResponse>(`${HACK_CLUB_AUTH_URL}/oauth/token`, {
        method: "POST",
        body: {
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
            grant_type: "authorization_code",
        },
    });
}

export async function refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
): Promise<TokenResponse> {
    return await $fetch<TokenResponse>(`${HACK_CLUB_AUTH_URL}/oauth/token`, {
        method: "POST",
        body: {
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        },
    });
}

export async function getUserInfo(accessToken: string): Promise<UserInfo> {
    return await $fetch<UserInfo>(`${HACK_CLUB_AUTH_URL}/api/v1/me`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
}
