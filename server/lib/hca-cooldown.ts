// Kept free of `#imports` so `bun test` can import it.

export type SyncHcaCooldownOpts = {
  cooldownMs?: number;
  force?: boolean;
};

export const DEFAULT_HCA_COOLDOWN_MS = 5 * 60 * 1000;

export function shouldSkipForCooldown(
  opts: SyncHcaCooldownOpts,
  lastSyncAt: Date | null,
  now: Date,
): boolean {
  if (opts.force) return false;
  if (!lastSyncAt) return false;
  return now.getTime() - lastSyncAt.getTime() < (opts.cooldownMs ?? DEFAULT_HCA_COOLDOWN_MS);
}
