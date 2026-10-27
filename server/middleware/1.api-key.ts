import {
  API_KEY_PREFIX,
  isApiKeyEligible,
  validateApiKey,
} from "../lib/api-keys";
import { checkRateLimits } from "../lib/rate-limit";
import { getRoutedPath } from "../lib/request-path";

// runs before auth.ts on every request, so the no-bearer exit must stay cheap.
// all access policy lives in isApiKeyEligible (server/lib/api-keys.ts), not here or per-endpoint.
const BEARER_RE = new RegExp(
  `^Bearer\\s+(${API_KEY_PREFIX}[A-Za-z0-9_-]+)$`,
  "i",
);

export default defineEventHandler(async (event) => {
  const match = BEARER_RE.exec((getHeader(event, "authorization") ?? "").trim());
  if (!match) return;

  // decoded path, so a percent-encoded internal path can't slip the denylist
  const path = getRoutedPath(event);
  if (!isApiKeyEligible(path, event.method)) {
    // fail loud on /api paths so integrators learn the boundary; pages just ignore the header
    if (path.startsWith("/api/")) {
      throw createError({
        statusCode: 401,
        statusMessage: "API keys cannot access this endpoint",
      });
    }
    return;
  }

  const auth = await validateApiKey(match[1]!);
  if (!auth) {
    setResponseHeader(event, "WWW-Authenticate", "Bearer");
    throw createError({ statusCode: 401, statusMessage: "Invalid API key" });
  }

  // per-key so one hot integration can't starve another: 20 per 5s burst, 60 per minute sustained
  const rl = await checkRateLimits(auth.keyId, "api_key", [
    [20, 5],
    [60, 60],
  ]);
  if (!rl.allowed) {
    setResponseHeader(event, "Retry-After", rl.retryAfterSeconds);
    throw createError({
      statusCode: 429,
      statusMessage: "Too many requests",
      data: { retryAfterSeconds: rl.retryAfterSeconds },
    });
  }

  event.context.apiKeyAuth = auth;
});
