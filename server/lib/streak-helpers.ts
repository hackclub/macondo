// Invalid or missing zones fall back to UTC so a bad tz value never throws at request time.
export function dayInTz(at: Date = new Date(), tz = "UTC"): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function todayStr(tz = "UTC"): string {
  return dayInTz(new Date(), tz);
}

export function localHourInTz(at: Date, tz?: string | null): number {
  if (!tz) return at.getUTCHours();
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(at);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    return Number.isFinite(h) ? h % 24 : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}

// Yesterday's hackatime totals keep settling for hours after local midnight, and a missed verdict
// is irreversible, so reconcile defers it inside this window (~3x the batch-sync cadence).
export const MISSED_VERDICT_GRACE_HOURS = 3;

export function inPostMidnightGrace(
  at: Date,
  tz?: string | null,
  graceHours = MISSED_VERDICT_GRACE_HOURS,
): boolean {
  return localHourInTz(at, tz) < graceHours;
}

// Canonical day key for streak_days, daily_project_activity, last_active_date and last_worked_date.
// Callers without a tz get the UTC fallback; use dayInTz for display-only labels.
export function streakDayKey(at?: Date | null, tz?: string | null): string {
  const t = at ?? new Date();
  if (!tz) return t.toISOString().slice(0, 10);
  return dayInTz(t, tz);
}

// Hackatime's heartbeat_timeout_duration (heartbeatable.rb); must match so our totals equal Hackatime's.
export const HACKATIME_HEARTBEAT_TIMEOUT_SECONDS = 120;

/**
 * Hackatime's exact duration rule: sum min(gap, timeout) over the time-sorted beats.
 * Callers merge every project's beats into one stream so project switches aren't double-counted.
 */
export function mergedGapSumSeconds(
  beats: ReadonlyArray<{ time: number }>,
  timeout: number = HACKATIME_HEARTBEAT_TIMEOUT_SECONDS,
): number {
  const sorted = [...beats].sort((a, b) => a.time - b.time);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]!.time - sorted[i - 1]!.time;
    if (gap > 0) total += Math.min(gap, timeout);
  }
  return Math.round(total);
}

/**
 * When several projects link the same hackatime name, only the earliest-created live project gets it.
 * Deleted projects claim nothing; the DAU recompute relies on losers getting an empty array.
 */
export function effectiveHackatimeNamesByProject(
  projects: Array<{
    id: number;
    hackatime_projects: string[] | null;
    created_at: Date | null;
    deleted_at?: Date | null;
  }>,
): Map<number, string[]> {
  const sorted = [...projects].sort(
    (a, b) => (a.created_at?.getTime() ?? 0) - (b.created_at?.getTime() ?? 0),
  );
  const claimed = new Set<string>();
  const result = new Map<number, string[]>();
  for (const p of sorted) {
    const mine: string[] = [];
    for (const n of p.deleted_at ? [] : (p.hackatime_projects ?? [])) {
      if (claimed.has(n)) continue;
      claimed.add(n);
      mine.push(n);
    }
    result.set(p.id, mine);
  }
  return result;
}

// UTC math on the day string treats it as an opaque calendar counter, so it's DST-safe.
export function yesterdayStr(today: string): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function shiftDayStr(dayStr: string, deltaDays: number): string {
  const d = new Date(dayStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// queue_entered_at wins over created_at because it is refreshed on resubmits.
export function computeReviewProtectedDays(
  ships: Array<{
    queue_entered_at: Date | string | null;
    created_at: Date | string | null;
    reviewed_at: Date | string | null;
  }>,
  tz: string,
  startDay: string,
  endDay: string,
): Set<string> {
  const out = new Set<string>();
  if (startDay > endDay) return out;
  for (const s of ships) {
    const enteredRaw = s.queue_entered_at ?? s.created_at;
    if (!enteredRaw) continue;
    const enteredAt = enteredRaw instanceof Date ? enteredRaw : new Date(enteredRaw);
    if (Number.isNaN(enteredAt.getTime())) continue;
    const enteredDay = dayInTz(enteredAt, tz);
    let exitedDay = endDay;
    if (s.reviewed_at) {
      const reviewedAt = s.reviewed_at instanceof Date ? s.reviewed_at : new Date(s.reviewed_at);
      if (!Number.isNaN(reviewedAt.getTime())) {
        exitedDay = dayInTz(reviewedAt, tz);
      }
    }
    let cursor = enteredDay > startDay ? enteredDay : startDay;
    const limit = exitedDay < endDay ? exitedDay : endDay;
    while (cursor <= limit) {
      out.add(cursor);
      cursor = shiftDayStr(cursor, 1);
    }
  }
  return out;
}

/**
 * A day is review-protected only when some solo project was queued and no other existing solo
 * project with a live streak was workable. Team projects are excluded (the team engine owns them).
 */
export function computeWorkAvailableReviewProtectedDays(opts: {
  projects: Array<{
    createdAt: Date | string | null;
    isTeam: boolean;
    projectStreakDays: number;
    ships: Array<{
      queue_entered_at: Date | string | null;
      created_at: Date | string | null;
      reviewed_at: Date | string | null;
    }>;
  }>;
  tz: string;
  startDay: string;
  endDay: string;
}): Set<string> {
  const { tz, startDay, endDay } = opts;
  const out = new Set<string>();
  if (startDay > endDay) return out;

  const solo = opts.projects.filter((p) => !p.isTeam);
  if (solo.length === 0) return out;

  const perProject = solo.map((p) => {
    let createdDay: string | null = null;
    if (p.createdAt) {
      const d = p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt);
      if (!Number.isNaN(d.getTime())) createdDay = dayInTz(d, tz);
    }
    return {
      createdDay,
      hasLiveStreak:
        (Number.isFinite(p.projectStreakDays)
          ? Math.max(0, Math.floor(p.projectStreakDays))
          : 0) >= 1,
      queueDays: computeReviewProtectedDays(p.ships, tz, startDay, endDay),
    };
  });

  let cursor = startDay;
  while (cursor <= endDay) {
    // A missing creation day counts as "always existed" so a bad timestamp can't grant protection.
    const existing = perProject.filter(
      (p) => p.createdDay === null || p.createdDay <= cursor,
    );
    const anyInQueue = existing.some((p) => p.queueDays.has(cursor));
    const hasWorkableAlternative = existing.some(
      (p) => !p.queueDays.has(cursor) && p.hasLiveStreak,
    );
    if (anyInQueue && !hasWorkableAlternative) {
      out.add(cursor);
    }
    cursor = shiftDayStr(cursor, 1);
  }
  return out;
}

/**
 * Heals days that were pending/missed/frozen before a covering ship entered review, which reconcile
 * never revisits. Frozen days also earn a freeze refund.
 */
export function planReviewProtectionBackfill(opts: {
  protectedDays: Iterable<string>;
  statusByDay: Map<string, string>;
}): Array<{ day: string; from: "pending" | "missed" | "frozen"; refundFreeze: boolean }> {
  const out: Array<{
    day: string;
    from: "pending" | "missed" | "frozen";
    refundFreeze: boolean;
  }> = [];
  for (const day of opts.protectedDays) {
    const status = opts.statusByDay.get(day);
    if (status === "pending" || status === "missed" || status === "frozen") {
      out.push({ day, from: status, refundFreeze: status === "frozen" });
    }
  }
  out.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

const isKeptStatus = (s: string | undefined): boolean =>
  s === "active" || s === "frozen" || s === "review_protected";

/**
 * Walks from a pending hole (pending is transparent) to its bound: "anchored" (kept day),
 * "gap" (absent day, which the old planner wrongly leapt) or "missed".
 */
export function walkGapBridgeOutcome(
  statusByDay: Map<string, string>,
  day: string,
  dir: 1 | -1,
): "anchored" | "gap" | "missed" {
  let cur = shiftDayStr(day, dir);
  for (let i = 0; i < 400; i++) { // safety cap on days walked
    const s = statusByDay.get(cur);
    if (s === undefined) return "gap";
    if (s === "missed") return "missed";
    if (isKeptStatus(s)) return "anchored";
    cur = shiftDayStr(cur, dir);
  }
  return "gap";
}

/** A historically wrong bridge: the hole only reached an anchor by leaping a calendar gap on a side. */
export function isGapLeapBridge(
  statusByDay: Map<string, string>,
  day: string,
): boolean {
  return (
    walkGapBridgeOutcome(statusByDay, day, -1) === "gap" ||
    walkGapBridgeOutcome(statusByDay, day, 1) === "gap"
  );
}

/** `sets` must be sorted ascending; `initial` is the value before the first audited change. */
export function masterToggleAt(opts: {
  initial: boolean;
  sets: Array<{ atMs: number; newM: boolean | null }>;
  atMs: number;
}): boolean {
  let state = opts.initial;
  for (const s of opts.sets) {
    if (s.atMs <= opts.atMs) state = s.newM ?? state;
    else break;
  }
  return state;
}

// A streak day needs hackatime + journal time summing to at least an hour (the program's 1h/day rule).
export const HACKATIME_STREAK_DAY_SECONDS = 60 * 60;

/**
 * Uses the max of live and stored (monotonic high-water) seconds, not the sum, so upstream drift
 * can't strip a day and the two never double-count. Journal seconds are added on top.
 */
export function dayQualifiesForProjectStreak(opts: {
  liveSeconds: number;
  storedSeconds: number;
  journalSeconds: number;
  threshold?: number;
}): boolean {
  const live = Math.max(0, Number.isFinite(opts.liveSeconds) ? opts.liveSeconds : 0);
  const stored = Math.max(
    0,
    Number.isFinite(opts.storedSeconds) ? opts.storedSeconds : 0,
  );
  const journal = Math.max(
    0,
    Number.isFinite(opts.journalSeconds) ? opts.journalSeconds : 0,
  );
  return Math.max(live, stored) + journal >= (opts.threshold ?? HACKATIME_STREAK_DAY_SECONDS);
}

/**
 * Frozen days count for opted-in projects that already had a streak, so the plant matches the headline.
 * review_protected is not counted because it only bridges the headline run.
 */
export function projectDayCountsForStreak(opts: {
  hoursQualify: boolean;
  userStreakStatus?:
    | "pending"
    | "active"
    | "frozen"
    | "missed"
    | "review_protected"
    | null;
  autoUseStreakFreezes: boolean;
  projectHasEarlierWork: boolean;
}): boolean {
  if (opts.hoursQualify) return true;
  return (
    opts.userStreakStatus === "frozen" &&
    opts.autoUseStreakFreezes &&
    opts.projectHasEarlierWork
  );
}

export function dayQualifiesForUserStreak(opts: {
  hackatimeSeconds: number;
  journalSeconds: number;
  threshold?: number;
}): boolean {
  const h = Math.max(
    0,
    Number.isFinite(opts.hackatimeSeconds) ? opts.hackatimeSeconds : 0,
  );
  const j = Math.max(
    0,
    Number.isFinite(opts.journalSeconds) ? opts.journalSeconds : 0,
  );
  return h + j >= (opts.threshold ?? HACKATIME_STREAK_DAY_SECONDS);
}

/**
 * recordStreakDay only checks today, so past pending days whose journal seconds grew later stay
 * stranded. Only promotes pending days, never demotes, so it's always safe to run.
 */
export function pendingDaysToRequalify(
  days: Array<{
    day: string;
    status: string;
    hackatimeSeconds: number;
    journalSeconds: number;
  }>,
  threshold: number = HACKATIME_STREAK_DAY_SECONDS,
): string[] {
  return days
    .filter(
      (d) =>
        d.status === "pending" &&
        dayQualifiesForUserStreak({
          hackatimeSeconds: d.hackatimeSeconds,
          journalSeconds: d.journalSeconds,
          threshold,
        }),
    )
    .map((d) => d.day);
}

/**
 * Heal when the recount beats the stored streak, else credit qualifying days stranded after
 * last_worked, else hold. A lower recount must never strip a higher stored value.
 */
export function resolveRecomputedStreak(opts: {
  storedStreak: number;
  storedLastWorked: string | null;
  recomputed: number;
  recomputedLastWorked: string | null;
  strandedAfterLastWorked: number;
}): { streak: number; lastWorked: string | null } {
  if (opts.recomputed > opts.storedStreak) {
    return { streak: opts.recomputed, lastWorked: opts.recomputedLastWorked };
  }
  if (opts.storedLastWorked !== null && opts.strandedAfterLastWorked > 0) {
    return {
      streak: opts.storedStreak + opts.strandedAfterLastWorked,
      lastWorked: opts.recomputedLastWorked,
    };
  }
  return { streak: opts.storedStreak, lastWorked: opts.storedLastWorked };
}

/** Starts after the last missed day so a just-reset project isn't rebuilt from its creation floor. */
export function recomputeWalkFloor(opts: {
  projectFloor: string;
  lastMissedDay: string | null;
}): string {
  if (opts.lastMissedDay === null) return opts.projectFloor;
  const dayAfterMiss = shiftDayStr(opts.lastMissedDay, 1);
  return dayAfterMiss > opts.projectFloor ? dayAfterMiss : opts.projectFloor;
}

/**
 * The capped heartbeat fetch pages oldest-first, so after truncation the newest covered day is
 * partial and later days are missing; both fall back to the cumulative fetch.
 */
export function unreliableDaysAfterTruncation(opts: {
  truncated: boolean;
  allDays: string[];
  newestCoveredDay: string | null;
}): string[] {
  if (!opts.truncated) return [];
  if (opts.newestCoveredDay === null) return [...opts.allDays];
  const cutoff = opts.newestCoveredDay;
  return opts.allDays.filter((d) => d >= cutoff);
}

/**
 * Bridges pending holes the gap-walk skipped: needs a kept day on both sides with no break, on or
 * after earliestPlantDay. All-or-nothing, since a single unbridged hole still breaks the run.
 */
export function planStrandedFreezeBackfill(opts: {
  statusByDay: Map<string, string>;
  today: string;
  freezesAvailable: number;
  canBurn: boolean;
  earliestPlantDay?: string | null;
}): { freezeDays: string[]; unresolvedNoFreeze: string[] } {
  const { statusByDay, today } = opts;
  const yesterday = shiftDayStr(today, -1);
  const isKept = (s: string | undefined): boolean =>
    s === "active" || s === "frozen" || s === "review_protected";
  const allDays = [...statusByDay.keys()].sort();
  const earliest = allDays[0];

  // Walk calendar days, not stored rows: an absent day is a break, or pre-project history gets bridged.
  const holes: string[] = [];
  for (const d of allDays) {
    if (d >= today) continue; // never heal today / future (in-progress)
    if (statusByDay.get(d) !== "pending") continue;
    if (opts.earliestPlantDay && d < opts.earliestPlantDay) continue;

    // Left anchor: an earlier break makes this the leading edge of a run, so don't bridge it.
    let earlierKept = false;
    for (
      let cur = shiftDayStr(d, -1);
      earliest !== undefined && cur >= earliest;
      cur = shiftDayStr(cur, -1)
    ) {
      const s = statusByDay.get(cur);
      if (s === undefined || s === "missed") break;
      if (isKept(s)) {
        earlierKept = true;
        break;
      }
    }
    if (!earlierKept) continue;

    // Right anchor stops at yesterday (today is in flight); a later break means the segment already died.
    let laterKept = false;
    let laterBreak = false;
    for (let cur = shiftDayStr(d, 1); cur <= yesterday; cur = shiftDayStr(cur, 1)) {
      const s = statusByDay.get(cur);
      if (s === undefined || s === "missed") {
        laterBreak = true;
        break;
      }
      if (isKept(s)) laterKept = true;
    }
    if (laterKept && !laterBreak) holes.push(d);
  }

  const freezesAvailable = Math.max(0, opts.freezesAvailable);
  if (opts.canBurn && holes.length > 0 && freezesAvailable >= holes.length) {
    return { freezeDays: holes, unresolvedNoFreeze: [] };
  }
  return { freezeDays: [], unresolvedNoFreeze: holes };
}

/**
 * Consecutive qualifying days ending at the most recent one, live only if that's today or yesterday.
 * Teams don't use freezes, so any non-qualifying day breaks the run.
 */
export function teamProjectStreakFromQualifyingDays(opts: {
  qualifyingDays: Set<string>;
  floor: string;
  today: string;
}): { streak: number; lastWorked: string | null } {
  const { qualifyingDays, floor, today } = opts;
  if (floor > today) return { streak: 0, lastWorked: null };
  const yesterday = shiftDayStr(today, -1);

  let mostRecent: string | null = null;
  let cursor = today;
  while (cursor >= floor) {
    if (qualifyingDays.has(cursor)) {
      mostRecent = cursor;
      break;
    }
    cursor = shiftDayStr(cursor, -1);
  }
  if (mostRecent === null) return { streak: 0, lastWorked: null };

  if (mostRecent < yesterday) return { streak: 0, lastWorked: null };

  let streak = 0;
  let walk = mostRecent;
  while (walk >= floor && qualifyingDays.has(walk)) {
    streak += 1;
    walk = shiftDayStr(walk, -1);
  }
  return { streak, lastWorked: mostRecent };
}

/**
 * Gap-intolerant streak for a project opted out of auto-freeze. Review days bridge without counting,
 * freezes don't bridge, and callers write it directly since it may decrease.
 */
export function optedOutProjectStreakFromDays(opts: {
  qualifyingDays: Set<string>;
  bridgedDays: Set<string>;
  floor: string;
  today: string;
}): { streak: number; lastWorked: string | null } {
  const { qualifyingDays, bridgedDays, floor, today } = opts;
  if (floor > today) return { streak: 0, lastWorked: null };
  const covered = (d: string): boolean =>
    qualifyingDays.has(d) || bridgedDays.has(d);

  // Today is in flight: with no covered row yet, anchor at yesterday.
  let cursor = covered(today) ? today : shiftDayStr(today, -1);

  let streak = 0;
  let lastWorked: string | null = null;
  while (cursor >= floor && covered(cursor)) {
    if (qualifyingDays.has(cursor)) {
      streak += 1;
      if (lastWorked === null) lastWorked = cursor;
    }
    cursor = shiftDayStr(cursor, -1);
  }

  if (lastWorked === null) return { streak: 0, lastWorked: null };
  return { streak, lastWorked };
}

/**
 * Stored streak + qualifying days after storedLastWorked, so a run built under opted-in rules keeps
 * growing after opt-out. Returns 0 (no credit) if any day between then and today is uncovered.
 */
export function optedOutCreditedRun(opts: {
  qualifyingDays: Set<string>;
  bridgedDays: Set<string>;
  storedStreak: number;
  storedLastWorked: string | null;
  runLastWorked: string | null;
  today: string;
}): number {
  const { qualifyingDays, bridgedDays, storedStreak, storedLastWorked, runLastWorked, today } =
    opts;
  if (storedLastWorked === null || runLastWorked === null) return 0;
  for (
    let d = shiftDayStr(storedLastWorked, 1);
    d < today;
    d = shiftDayStr(d, 1)
  ) {
    // Days before the walk window are never in the sets, so an ancient last_worked yields 0.
    if (!qualifyingDays.has(d) && !bridgedDays.has(d)) return 0;
  }
  let after = 0;
  for (const d of qualifyingDays) {
    if (d > storedLastWorked && d <= today) after += 1;
  }
  return after > 0 ? storedStreak + after : 0;
}

// Longest genuine review window in prod was 51.5 days; longer spans are ops scripts restamping reviewed_at.
export const MAX_REVIEW_BRIDGE_SPAN_DAYS = 60;

export interface ReviewBridgeShip {
  // Computed by the caller from REVIEW_LOOP_SHIP_STATUSES so this file never imports streaks.ts.
  inReviewLoop: boolean;
  queueEnteredAt: Date | null;
  createdAt: Date | null;
  reviewedAt: Date | null;
  projectStreakDaysAtSubmission: number | null;
  projectLastWorkedDateAtSubmission: string | null;
}

/**
 * Bridge days from ship rows so an opted-out plant's review hold survives the decision. Window: day after
 * last_worked at submission (else queue entry) through reviewed_at (else today while in review).
 */
export function reviewBridgeDaysForProject(opts: {
  ships: ReviewBridgeShip[];
  tz: string | null;
  floor: string;
  today: string;
}): Set<string> {
  const { ships, tz, floor, today } = opts;
  const bridged = new Set<string>();
  for (const ship of ships) {
    const close = ship.reviewedAt
      ? streakDayKey(ship.reviewedAt, tz)
      : ship.inReviewLoop
        ? today
        : null;
    if (close === null) continue;

    const lastWorkedSnap =
      (ship.projectStreakDaysAtSubmission ?? 0) >= 1
        ? ship.projectLastWorkedDateAtSubmission
        : null;
    const queuedAt = ship.queueEnteredAt ?? ship.createdAt;
    const open = lastWorkedSnap !== null
      ? shiftDayStr(lastWorkedSnap, 1)
      : queuedAt
        ? streakDayKey(queuedAt, tz)
        : null;
    if (open === null || open > close) continue;

    if ((Date.parse(close) - Date.parse(open)) / 86_400_000 > MAX_REVIEW_BRIDGE_SPAN_DAYS) continue; // ms per day

    const last = close < today ? close : today;
    for (
      let d = open < floor ? floor : open;
      d <= last;
      d = shiftDayStr(d, 1)
    ) {
      bridged.add(d);
    }
  }
  return bridged;
}

/**
 * Any member's work qualifies a day, and member freezes/review days bridge without counting.
 * Mirrors the per-user recompute: walk floor after the last break, then resolveRecomputedStreak.
 */
export function computeTeamRecompute(opts: {
  qualifyingDays: Set<string>;
  coveredDays: Set<string>;
  projectFloor: string;
  today: string;
  storedStreak: number;
  storedLastWorked: string | null;
}): {
  streak: number;
  lastWorked: string | null;
  walkFloor: string;
  lastBreak: string | null;
  recomputed: number;
} {
  const { qualifyingDays, coveredDays, projectFloor, today, storedStreak, storedLastWorked } = opts;

  // Today is still in flight, so it's never a break.
  let lastBreak: string | null = null;
  let scan = shiftDayStr(today, -1);
  while (scan >= projectFloor) {
    if (!coveredDays.has(scan)) {
      lastBreak = scan;
      break;
    }
    scan = shiftDayStr(scan, -1);
  }

  const walkFloor = recomputeWalkFloor({ projectFloor, lastMissedDay: lastBreak });

  let recomputed = 0;
  let recomputedLastWorked: string | null = null;
  let strandedAfterLastWorked = 0;
  let walk = walkFloor;
  while (walk <= today) {
    if (qualifyingDays.has(walk)) {
      recomputed += 1;
      recomputedLastWorked = walk;
      if (storedLastWorked !== null && walk > storedLastWorked) {
        strandedAfterLastWorked += 1;
      }
    }
    walk = shiftDayStr(walk, 1);
  }

  const resolved = resolveRecomputedStreak({
    storedStreak,
    storedLastWorked,
    recomputed,
    recomputedLastWorked,
    strandedAfterLastWorked,
  });

  return {
    streak: resolved.streak,
    lastWorked: resolved.lastWorked,
    walkFloor,
    lastBreak,
    recomputed,
  };
}

/**
 * active and frozen days count; review_protected only bridges, so streaks hold rather than grow
 * during review waits.
 */
export function currentStreakLengthFromDays(opts: {
  statusByDay: Map<string, string>;
  today: string;
  windowStart: string;
  // Trailing no-row days to skip before anchoring, since reconcile lags far-east-of-UTC local days.
  reconcileLagGraceDays?: number;
  // Today cleared the floor live but its row isn't flipped yet; count it now instead of lagging a sync.
  todayQualifiedLive?: boolean;
}): number {
  const { statusByDay, today, windowStart } = opts;
  const isKept = (s: string | undefined): boolean =>
    s === "active" || s === "frozen" || s === "review_protected";
  const isRealWork = (s: string | undefined): boolean =>
    s === "active" || s === "frozen";

  const todayStatus = statusByDay.get(today);
  if (todayStatus === "missed") return 0;

  const todayCountsLive =
    opts.todayQualifiedLive === true && !isKept(todayStatus);

  // Start from yesterday so an in-progress day never reads as broken.
  let cursor =
    isKept(todayStatus) || todayCountsLive ? today : yesterdayStr(today);

  // Skip a bounded run of not-yet-reconciled days: reconcile lags far-east-of-UTC users, and the
  // bound keeps a genuinely dead streak dead.
  if (!todayCountsLive && statusByDay.get(cursor) === undefined) {
    const graceDays = opts.reconcileLagGraceDays ?? 2;
    let probe = cursor;
    let skipped = 0;
    while (
      skipped < graceDays &&
      probe > windowStart &&
      statusByDay.get(probe) === undefined
    ) {
      probe = yesterdayStr(probe);
      skipped += 1;
    }
    if (statusByDay.get(probe) !== undefined) cursor = probe;
  }

  let count = 0;
  let sawRealWork = false;
  while (cursor >= windowStart) {
    const status = statusByDay.get(cursor);
    const countsLiveHere = cursor === today && todayCountsLive;
    if (!isKept(status) && !countsLiveHere) break;
    if (isRealWork(status) || countsLiveHere) {
      count += 1;
      sawRealWork = true;
    }
    cursor = yesterdayStr(cursor);
  }
  return sawRealWork ? count : 0;
}

/**
 * Headline streak floored at the best project streak (the day run can lag the recompute) and at
 * the streak captured when a still-open ship entered review.
 */
export function dashboardStreak(opts: {
  streakDaysRun: number;
  maxProjectStreak: number | null;
  reviewFloor?: number | null;
}): number {
  const run = Math.max(
    0,
    Number.isFinite(opts.streakDaysRun) ? opts.streakDaysRun : 0,
  );
  const proj = Math.max(
    0,
    Number.isFinite(opts.maxProjectStreak ?? 0) ? (opts.maxProjectStreak ?? 0) : 0,
  );
  const reviewFloor = Math.max(
    0,
    Number.isFinite(opts.reviewFloor ?? 0) ? (opts.reviewFloor ?? 0) : 0,
  );
  return Math.max(run, proj, reviewFloor);
}

/**
 * A freeze is only worth burning for an opted-in, live-streak project that isn't deleted (deletion
 * keeps stale streak fields) or already held by review.
 */
export function hasProtectableProjectStreak(
  projects: Array<{
    id?: number;
    auto_use_streak_freezes: boolean;
    project_streak_days: number;
    deleted_at?: Date | string | null;
  }>,
  reviewProtectedIds?: Set<number>,
): boolean {
  return projects.some(
    (p) =>
      !p.deleted_at &&
      p.auto_use_streak_freezes &&
      p.project_streak_days >= 1 &&
      !(p.id !== undefined && reviewProtectedIds?.has(p.id)),
  );
}

/**
 * Refunds a freeze for a frozen day that late activity proves qualified. The day flips to active
 * even when the wallet is at maxFreezes (refunded is then false).
 */
export function planFreezeRefund(opts: {
  currentStatus: "pending" | "active" | "frozen" | "missed" | "review_protected";
  liveSeconds: number;
  storedSeconds: number;
  journalSeconds: number;
  freezesRemaining: number;
  threshold?: number;
  maxFreezes?: number;
}): {
  flip: boolean;
  qualifies: boolean;
  newFreezes: number;
  refunded: boolean;
  recoveredSeconds: number;
} {
  const maxFreezes = opts.maxFreezes ?? 5;
  const remaining = Math.max(
    0,
    Number.isFinite(opts.freezesRemaining) ? Math.floor(opts.freezesRemaining) : 0,
  );
  const live = Math.max(0, Number.isFinite(opts.liveSeconds) ? opts.liveSeconds : 0);
  const stored = Math.max(
    0,
    Number.isFinite(opts.storedSeconds) ? opts.storedSeconds : 0,
  );
  const qualifies = dayQualifiesForProjectStreak({
    liveSeconds: live,
    storedSeconds: stored,
    journalSeconds: opts.journalSeconds,
    threshold: opts.threshold,
  });
  const flip = opts.currentStatus === "frozen" && qualifies;
  const newFreezes = flip ? Math.min(maxFreezes, remaining + 1) : remaining;
  return {
    flip,
    qualifies,
    newFreezes,
    refunded: newFreezes > remaining,
    recoveredSeconds: Math.floor(Math.max(live, stored)),
  };
}

// Caps a single bad journal row (one had 1.9M hours) so it can't poison downstream aggregates.
export const MAX_DAILY_SECONDS_PER_PROJECT = 24 * 60 * 60;

export function hoursToSeconds(hours: number | null | undefined): number {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.min(Math.round(h * 3600), MAX_DAILY_SECONDS_PER_PROJECT); // hours to seconds
}

/** Hackatime's cumulative API can drift down after a day ends, so keep the high-water mark. */
export function nextMonotonicHackatimeSeconds(
  existing: number,
  incoming: number,
): number {
  const e = Math.max(0, Math.floor(Number.isFinite(existing) ? existing : 0));
  const i = Math.max(0, Math.floor(Number.isFinite(incoming) ? incoming : 0));
  return Math.max(e, i);
}

/** The submit-time snapshot floors the multiplier so review latency can't erode it; live can still raise it. */
export function effectiveStreakDaysForShip(args: {
  snapshot: number | null | undefined;
  liveStreakDays: number;
}): number {
  const snapRaw = args.snapshot ?? 0;
  const snap = Math.max(0, Number.isFinite(snapRaw) ? snapRaw : 0);
  const live = Math.max(
    0,
    Number.isFinite(args.liveStreakDays) ? args.liveStreakDays : 0,
  );
  return Math.max(snap, live);
}

const NEW_STREAK_CAP_DAYS_BY_LEVEL: Record<number, number> = {
  1: 100, // 2.00x
  2: 88,  // 1.88x
  3: 70,  // 1.70x
  4: 41,  // 1.41x
};

export function projectMultiplierForRun(args: {
  projectStreakDays: number;
  lastWorkedDate: string | null | undefined;
  level: number | null | undefined;
}): number {
  const days = Math.max(
    0,
    Number.isFinite(args.projectStreakDays) ? args.projectStreakDays : 0,
  );
  if (days <= 0) return 1;

  const lastWorked = args.lastWorkedDate ?? null;
  if (!lastWorked) return 1 + days * 0.01; // +1% per streak day

  const streakStart = shiftDayStr(lastWorked, -(days - 1));
  const capDays = NEW_STREAK_CAP_DAYS_BY_LEVEL[args.level ?? 0] ?? days;

  // Runs starting on/after 2026-07-02 use the lower cap; older live runs are grandfathered until they break.
  return 1 + (streakStart >= "2026-07-02" ? Math.min(days, capDays) : days) * 0.01; // +1% per streak day
}

/**
 * Only real work from today or yesterday may advance last_active_date: it anchors the reconcile
 * gap-walk, so stamping a zero-activity day skips that day's freeze burn.
 */
export function syncLastActiveCandidate(
  prev: string | null,
  newLastWorked: string | null,
  today: string,
  yesterday: string,
): string | null {
  if (!newLastWorked) return prev;
  if (newLastWorked !== today && newLastWorked !== yesterday) return prev;
  if (!prev || newLastWorked > prev) return newLastWorked;
  return prev;
}

/** refundedCount can be 0 when the wallet was full; those days still unfreeze, so we still notify. */
export function freezeRefundedNotification(opts: {
  days: string[];
  refundedCount: number;
  freezesLeft: number;
}): { title: string; body: string } {
  const { days, refundedCount, freezesLeft } = opts;
  const dayPhrase =
    days.length === 1
      ? `${days[0]} counts toward your streak after all`
      : `${days.join(", ")} count toward your streak after all`;
  const leftNoun = freezesLeft === 1 ? "freeze" : "freezes";
  return {
    title:
      refundedCount === 1
        ? "Streak freeze refunded"
        : "Streak freezes refunded",
    body:
      `Your work on ${dayPhrase}. ` +
      (refundedCount > 0
        ? `We gave back ${refundedCount} streak ${
            refundedCount === 1 ? "freeze" : "freezes"
          }, so you have ${freezesLeft} streak ${leftNoun} left.`
        : `Your wallet was already full, so you still have ${freezesLeft} streak ${leftNoun}.`),
  };
}
