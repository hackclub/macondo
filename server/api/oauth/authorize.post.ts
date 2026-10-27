// No session needed: the pasted MCP token is the credential.
import { validateMcpToken } from "../../lib/mcp/auth";
import { issueAuthCode, baseUrl, validateMcpRedirectUri } from "../../lib/mcp/oauth";
import { mlog } from "../../lib/mcp/log";

interface Body {
  token?: string;
  redirect_uri?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

export default defineEventHandler(async (event) => {
  const body = (await readBody<Body>(event).catch(() => ({}))) as Body;
  const redirectUri = String(body.redirect_uri ?? "");
  const codeChallenge = String(body.code_challenge ?? "");
  const codeChallengeMethod = String(body.code_challenge_method ?? "");
  const state = String(body.state ?? "");
  const token = String(body.token ?? "").trim();

  if (!redirectUri) {
    throw createError({ statusCode: 400, statusMessage: "Missing redirect_uri." });
  }
  const redirectUriError = validateMcpRedirectUri(redirectUri);
  if (redirectUriError) {
    throw createError({ statusCode: 400, statusMessage: redirectUriError });
  }
  // PKCE is mandatory: the token exchange refuses a code without an S256
  // challenge, so an intercepted code alone can never be exchanged.
  if (!codeChallenge) {
    throw createError({
      statusCode: 400,
      statusMessage: "A PKCE code_challenge (S256) is required.",
    });
  }
  if (codeChallengeMethod !== "S256") {
    throw createError({
      statusCode: 400,
      statusMessage: "Only PKCE code_challenge_method=S256 is supported.",
    });
  }

  const ctx = token ? await validateMcpToken(token) : null;
  if (!ctx) {
    mlog("oauth", "authorize submit → rejected token");
    throw createError({
      statusCode: 400,
      statusMessage: "That token is invalid, revoked, or not a supaadmin token.",
    });
  }

  const code = await issueAuthCode({
    userId: ctx.user.id,
    canWrite: ctx.canWrite,
    codeChallenge,
    redirectUri,
  });

  const dest = new URL(redirectUri);
  dest.searchParams.set("code", code);
  if (state) dest.searchParams.set("state", state);
  // RFC 9207: identify the issuer in the authorization response.
  dest.searchParams.set("iss", baseUrl(getRequestURL(event).origin));
  mlog("oauth", "authorize submit → redirect with code", { to: dest.origin + dest.pathname });

  return { redirect: dest.toString() };
});
