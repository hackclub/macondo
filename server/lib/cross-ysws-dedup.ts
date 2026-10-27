// No DB or airtable.ts imports so `bun test` can load it without the Nuxt runtime.
export type UnifiedYswsMatch = {
  recordId: string;
  ysws: string;
  url: string;
  field: "Code URL" | "Playable URL";
  hours: number;
  firstSubmittedAt: Date | null;
  inWindow: boolean;
  // A Macondo row (opt-in via includeSelf). Display-and-block ONLY: the hours helpers skip it so it can't deflate payouts.
  isSelf?: boolean;
};

// override_hours is hybrid: the journal half is cumulative but software_override_hours is per-update,
// so only the journal half is diffed against the previous ship.
export function computeUpdateShipDelta(args: {
  isUpdateShip: boolean;
  currentOverrideHours: number;
  previousOverrideHours: number;
  currentSoftwareOverrideHours: number;
  previousSoftwareOverrideHours: number;
}): number {
  const {
    isUpdateShip,
    currentOverrideHours,
    previousOverrideHours,
    currentSoftwareOverrideHours,
    previousSoftwareOverrideHours,
  } = args;
  if (!isUpdateShip) {
    return Math.max(0, currentOverrideHours);
  }
  const journalDelta = Math.max(
    0,
    currentOverrideHours -
      currentSoftwareOverrideHours -
      (previousOverrideHours - previousSoftwareOverrideHours),
  );
  return journalDelta + Math.max(0, currentSoftwareOverrideHours);
}

// Pre-window matches are only a fraud signal, never a deduction cutoff.
export function pickLatestInWindowApprovalDate(
  matches: UnifiedYswsMatch[],
): Date | null {
  let latest: Date | null = null;
  for (const m of matches) {
    if (m.isSelf) continue;
    if (!m.inWindow) continue;
    if (!m.firstSubmittedAt) continue;
    if (!latest || m.firstSubmittedAt.getTime() > latest.getTime()) {
      latest = m.firstSubmittedAt;
    }
  }
  return latest;
}

// Fallback when Hackatime hours can't be resolved.
export function sumCreditedInWindowHours(matches: UnifiedYswsMatch[]): number {
  let total = 0;
  for (const m of matches) {
    if (m.isSelf) continue;
    if (!m.inWindow) continue;
    if (Number.isFinite(m.hours)) total += m.hours;
  }
  return total;
}

// The difference is hours logged (all projects) BEFORE the most recent other YSWS approval.
export function computeHackatimeBasedDeduction(
  totalHoursSinceMacondoStart: number,
  totalHoursSinceLatestApproved: number,
): number {
  if (!Number.isFinite(totalHoursSinceMacondoStart)) return 0;
  if (!Number.isFinite(totalHoursSinceLatestApproved)) return 0;
  return Math.max(
    0,
    totalHoursSinceMacondoStart - totalHoursSinceLatestApproved,
  );
}

// Intentionally broader than ship.is_update: a first Macondo ship whose URL is already in the unified DB under
// another program is still an update, matching the submit-time gate in ship.post.ts.
export function shipCountsAsUnifiedUpdate(args: {
  hasPriorShippedMacondoShip: boolean;
  unifiedMatchCount: number;
}): boolean {
  return args.hasPriorShippedMacondoShip || args.unifiedMatchCount > 0;
}

