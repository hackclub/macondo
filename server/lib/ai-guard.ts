import { checkRateLimit } from "./rate-limit";

export type AiGuardResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export async function guardAiRequest(opts: {
  userId: number | string;
  bucket: "hint" | "validate";
  payload: string;
  limit?: number;
  windowSeconds?: number;
  maxPayloadBytes?: number;
}): Promise<AiGuardResult> {
  const maxPayloadBytes = opts.maxPayloadBytes ?? 50_000;

  const payloadBytes = Buffer.byteLength(opts.payload, "utf8");
  if (payloadBytes > maxPayloadBytes) {
    return {
      ok: false,
      status: 413,
      message: `Your code is too large for an AI review (${payloadBytes} bytes, max ${maxPayloadBytes}). Trim it down and try again.`,
    };
  }

  const rate = await checkRateLimit(
    opts.userId,
    opts.bucket,
    opts.limit ?? 20, // requests allowed per window
    opts.windowSeconds ?? 60, // rate limit window in seconds
  );
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      message: `You are clicking a bit too fast. Wait ${rate.retryAfterSeconds} seconds and try again.`,
    };
  }

  return { ok: true };
}
