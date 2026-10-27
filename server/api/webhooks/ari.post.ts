// The signature is the only auth, so verify the raw body before any JSON parse. ARI retries:
// ack 200 what retries can't fix, 500 transient failures, 422 reviewer-fixable ones so ARI shows FAILED.

import {
  parseAriInboundEvent,
  processAriInboundEvent,
  recordAriSignatureRejection,
  verifyAriSignature,
} from "../../lib/ari-inbound";

export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event, "utf8");
  if (!raw) {
    throw createError({ statusCode: 400, statusMessage: "Empty body" });
  }

  const signature = getHeader(event, "x-ari-signature");
  const timestamp = getHeader(event, "x-ari-timestamp");
  const deliveryId = getHeader(event, "x-ari-delivery-id");
  if (!verifyAriSignature(raw, signature, timestamp, deliveryId)) {
    // A fresh, fully signed failure is a real ARI delivery we're dropping; alert, since
    // an unnoticed 401 flood once silently lost decisions for weeks.
    const ts = Number(timestamp);
    if (
      signature &&
      deliveryId &&
      Number.isFinite(ts) &&
      Math.abs(Date.now() / 1000 - ts) < 600 // 10 minute freshness window
    ) {
      recordAriSignatureRejection();
    }
    throw createError({ statusCode: 401, statusMessage: "Invalid signature" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid JSON" });
  }

  const payload = parseAriInboundEvent(parsed);
  if (!payload) {
    // Ack so ARI doesn't burn retries on a body that will never parse.
    console.warn("[ari-webhook] signed payload failed shape validation");
    return { ok: true, result: "invalid_payload" };
  }

  return await processAriInboundEvent(payload);
});
