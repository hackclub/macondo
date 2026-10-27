// Kept dependency-free so it can be unit tested outside Nitro.
// The deploy-time backfill rescans old messages, so Capybara must only reply to fresh threads.

// live webhook events land within seconds; older means backfill catch-up
export const CAPYBARA_MAX_THREAD_AGE_MS = 60 * 60 * 1000;

// Slack ts is "<epoch seconds>.<counter>"; unparseable means no auto-reply, never a throw.
export function isFreshSlackTs(ts: string, now: number = Date.now()): boolean {
  const epochSeconds = Number.parseFloat(ts);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return false;
  return now - epochSeconds * 1000 < CAPYBARA_MAX_THREAD_AGE_MS;
}
