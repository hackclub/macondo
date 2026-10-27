// Kept dependency-free so tests can import it without the DB / Slack graph.
// These skips never get a ticket row, so without this every backfill tick re-probes them.

export type BackfillSkipReason = "unknown_user" | "bot_already_replied";

const negativeTsCache = new Map<
  string,
  { reason: BackfillSkipReason; at: number }
>();

export function rememberBackfillSkip(
  channel: string,
  ts: string,
  reason: BackfillSkipReason,
  nowMs = Date.now(),
): void {
  const key = `${channel}:${ts}`;
  // delete first so a re-remembered key moves to the back and the cap evicts the stalest
  negativeTsCache.delete(key);
  if (negativeTsCache.size >= 5000) { // negative cache entry cap
    const oldest = negativeTsCache.keys().next().value;
    if (oldest !== undefined) negativeTsCache.delete(oldest);
  }
  negativeTsCache.set(key, { reason, at: nowMs });
}

export function recallBackfillSkip(
  channel: string,
  ts: string,
  nowMs = Date.now(),
): BackfillSkipReason | null {
  const key = `${channel}:${ts}`;
  const hit = negativeTsCache.get(key);
  if (!hit) return null;
  if (nowMs - hit.at > 24 * 60 * 60 * 1000) { // negative cache ttl, one day
    negativeTsCache.delete(key);
    return null;
  }
  return hit.reason;
}
