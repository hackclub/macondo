// Kept free of `#imports` so `bun test` can import it.

type HttpErrorLike = { status?: number; statusCode?: number; data?: unknown };

function httpStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as HttpErrorLike;
  return e.status ?? e.statusCode ?? null;
}

// HCA (Doorkeeper) answers a revoked or expired refresh token with 400 invalid_grant; retrying can never succeed.
export function isDeadRefreshToken(err: unknown): boolean {
  if (httpStatus(err) !== 400) return false;
  const data = (err as HttpErrorLike).data;
  return typeof data === "object" && data !== null && (data as { error?: unknown }).error === "invalid_grant";
}

// HCA allows 20 POST /oauth/token per minute per source IP, and on orchard that IP is shared by every app on the node.
export function isHcaRateLimited(err: unknown): boolean {
  return httpStatus(err) === 429;
}

export class HcaRateLimitedError extends Error {
  constructor() {
    super("HCA /oauth/token rate limited (429)");
    this.name = "HcaRateLimitedError";
  }
}
