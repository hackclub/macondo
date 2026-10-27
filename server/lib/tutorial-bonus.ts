// no DB imports, so it stays unit-testable under bun test without the #imports alias.
// hackatime_hours bundles a +1h bonus on the earliest ship of the html tutorial only,
// so delta math must subtract it from both sides.

export const TUTORIAL_BONUS_HOURS = 1;
export const TUTORIAL_BONUS_GUIDE = "html";

export function computeTutorialBonusHours(opts: {
  projectGuide: string | null | undefined;
  shipId: number;
  earliestShipId: number | null;
}): number {
  if (opts.projectGuide !== TUTORIAL_BONUS_GUIDE) return 0;
  if (opts.earliestShipId == null) return 0;
  return opts.shipId === opts.earliestShipId ? TUTORIAL_BONUS_HOURS : 0;
}

// mirrors AriJournalInput in server/lib/ari-payload.ts, duplicated to avoid ARI imports
export interface TutorialCreditJournal {
  at: Date | null;
  hours: number;
  title: string;
  body: string;
  authorEmail: string | null;
}

// ARI only credits captured evidence and ignores self-reported hours, so without
// this devlog tutorial ships show ~0 tracked time and get rejected (ship 3056).
export function buildTutorialCreditJournal(opts: {
  projectGuide: string | null | undefined;
  shipId: number;
  earliestShipId: number | null;
  at: Date | null;
  authorEmail: string | null;
}): TutorialCreditJournal | null {
  const hours = computeTutorialBonusHours({
    projectGuide: opts.projectGuide,
    shipId: opts.shipId,
    earliestShipId: opts.earliestShipId,
  });
  if (hours <= 0) return null;
  return {
    at: opts.at,
    hours,
    title: "Onboarding HTML tutorial: 1h completion credit",
    body:
      "Macondo credits a fixed 1 hour for completing the guided HTML/CSS " +
      "walkthrough at /guides/html. That tutorial runs entirely in the " +
      "browser, so Hackatime cannot track the time spent on it. This entry " +
      "carries the canned tutorial credit so the hour counts as verified time " +
      "here instead of being lost. It is additive to any Hackatime time " +
      "captured from the learner's own commits on this project.",
    authorEmail: opts.authorEmail,
  };
}

// use this whenever comparing logged hackatime time across ships
export function realHackatimeHours(
  ship: { id: number; hackatime_hours: number | null },
  opts: {
    projectGuide: string | null | undefined;
    earliestShipId: number | null;
  },
): number {
  const bonus = computeTutorialBonusHours({
    projectGuide: opts.projectGuide,
    shipId: ship.id,
    earliestShipId: opts.earliestShipId,
  });
  return Math.max(0, (ship.hackatime_hours ?? 0) - bonus);
}

// hackatime_hours is resnapshotted upward while in review, so baselining on it swallows
// review-window hours; use the approved override, falling back for legacy null rows.
export function creditedHackatimeHours(ship: {
  hackatime_hours: number | null;
  software_override_hours?: number | null;
}): number {
  return ship.software_override_hours ?? ship.hackatime_hours ?? 0;
}

// both bounds read columns that move on approve/revert, so apply on every read, never cache
// (see server/lib/ship-submit-time-hours.ts)
export function clampSubmitTimeHours(
  raw: number,
  ship: {
    hackatime_hours: number | null;
    software_override_hours?: number | null;
  },
): number {
  return Math.max(
    typeof ship.hackatime_hours === "number"
      ? Math.min(raw, ship.hackatime_hours)
      : raw,
    creditedHackatimeHours(ship),
  );
}

// clampSubmitTimeHours without the credited floor: group ships credit the whole team under
// the owner's row, so the strict-increase gate must compare logged hours on both sides
export function loggedSubmitTimeHours(
  submitTimeHours: number,
  ship: { hackatime_hours: number | null },
): number {
  return typeof ship.hackatime_hours === "number"
    ? Math.min(submitTimeHours, ship.hackatime_hours)
    : submitTimeHours;
}

// previous side uses credited hours so uncredited review-window hours stay claimable
export function computeHackatimeDeltaWithBonus(
  current: { id: number; hackatime_hours: number | null },
  previous: {
    id: number;
    hackatime_hours: number | null;
    software_override_hours?: number | null;
  },
  opts: {
    projectGuide: string | null | undefined;
    earliestShipId: number | null;
  },
): number {
  return Math.max(
    0,
    realHackatimeHours(current, opts) -
      realHackatimeHours(
        { id: previous.id, hackatime_hours: creditedHackatimeHours(previous) },
        opts,
      ),
  );
}
