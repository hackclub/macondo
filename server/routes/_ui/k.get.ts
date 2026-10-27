// For tabs that outlive their key bucket. Same gate as the catalog, so it's no weaker a link.

import { assertFirstPartyRequest } from "../../lib/first-party";
import { checkRateLimits } from "../../lib/rate-limit";
import { mintObfSecret, mintPathToken, verifyUiToken } from "../../lib/ui-token";
import { obfBucket } from "../../../shared/utils/shop-obfuscation";

export default defineEventHandler(async (event) => {
  const secret = ((useRuntimeConfig().uiGateSecret as string) ?? "").trim();
  if (!secret) return { p: "dev", s: "", b: 0 };

  if (!verifyUiToken(secret, getCookie(event, "mq_ui"))) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }
  assertFirstPartyRequest(event);

  // A browser needs this at most hourly; anything faster is key farming.
  const rate = await checkRateLimits(
    getCookie(event, "mq_ui")?.slice(0, 32) ?? "anon", // cap rate-limit key length
    "ui-rekey",
    [
      [5, 60], // 5 per minute
      [30, 3600], // 30 per hour
    ],
  );
  if (!rate.allowed) {
    setResponseHeader(event, "Retry-After", rate.retryAfterSeconds);
    throw createError({ statusCode: 429, statusMessage: "Too many requests" });
  }

  const bucket = obfBucket(Date.now());
  return {
    p: mintPathToken(secret, bucket),
    s: mintObfSecret(secret, bucket),
    b: bucket,
  };
});
