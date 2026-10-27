// approved_hours is cumulative but the pushed total is a per-update delta, so it's used as a WEIGHT, not pushed
// verbatim (that would double-count update ships). No `#imports`/`server/db` so it loads under `bun test`.

export type ContributorWeight = {
  user_id: string;
  approved_hours: number | null;
  hackatime_hours: number | null;
};

export type ContributorHoursShare = {
  user_id: string;
  hours: number;
};

// A negative pushed total (cross-YSWS dedup exceeding the delta) collapses every share to 0.
export function splitPushedHours(
  contributors: ContributorWeight[],
  pushedHours: number,
  ownerId: string,
): ContributorHoursShare[] {
  if (contributors.length === 0) return [];

  // Owner first, so the rounding residual lands on the row carrying ship.airtable_record_id.
  const ordered = [...contributors].sort((a, b) =>
    a.user_id === ownerId ? -1 : b.user_id === ownerId ? 1 : 0,
  );

  const total = Math.max(0, Math.round(pushedHours * 100) / 100);
  if (total === 0) {
    return ordered.map((c) => ({ user_id: c.user_id, hours: 0 }));
  }

  const weightOf = (c: ContributorWeight, key: keyof ContributorWeight) => {
    const v = c[key];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  };
  let weights = ordered.map((c) => weightOf(c, "approved_hours"));
  if (weights.reduce((a, b) => a + b, 0) <= 0) {
    weights = ordered.map((c) => weightOf(c, "hackatime_hours"));
  }
  if (weights.reduce((a, b) => a + b, 0) <= 0) {
    weights = ordered.map(() => 1);
  }

  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = ordered.map((c, i) => ({
    user_id: c.user_id,
    hours: Math.round(total * (weights[i]! / sum) * 100) / 100,
  }));

  const residual =
    Math.round((total - shares.reduce((a, s) => a + s.hours, 0)) * 100) / 100;
  if (residual !== 0 && shares[0]) {
    shares[0].hours = Math.max(
      0,
      Math.round((shares[0].hours + residual) * 100) / 100,
    );
  }

  return shares;
}

export type ContributorGoldShare = {
  user_id: string;
  amount: number;
  hours: number;
};

// The gold split of an approved ship, weighted by each contributor's hours. Slices sum to exactly goldReward.
export function splitGoldByHours(
  contributors: Array<{ user_id: string; hours: number }>,
  goldReward: number,
  finalApprovedHours: number,
  ownerId: string,
): ContributorGoldShare[] {
  if (contributors.length === 0) {
    // Defensive: legacy ship with no contributor snapshot, so the owner gets everything.
    return [{ user_id: ownerId, amount: goldReward, hours: finalApprovedHours }];
  }

  const totalHours = contributors.reduce((a, c) => a + c.hours, 0);
  if (totalHours <= 0) {
    // Nobody has hours; fall back to an even split so reviewer intent isn't blocked by missing telemetry.
    const evenAmount = Math.floor(goldReward / contributors.length);
    let residual = goldReward - evenAmount * contributors.length;
    return contributors.map((c) => {
      const amount = evenAmount + (residual > 0 ? 1 : 0);
      if (residual > 0) residual -= 1;
      return { user_id: c.user_id, amount, hours: finalApprovedHours / contributors.length };
    });
  }

  // The last contributor absorbs the rounding residual so slices sum to exactly goldReward.
  let allocated = 0;
  const ordered = [...contributors].sort((a, b) =>
    a.user_id === ownerId ? -1 : b.user_id === ownerId ? 1 : 0,
  );
  return ordered.map((c, i) => {
    const amount =
      i === ordered.length - 1
        ? goldReward - allocated
        : Math.floor(goldReward * (c.hours / totalHours));
    allocated += amount;
    return { user_id: c.user_id, amount, hours: c.hours * (finalApprovedHours / totalHours) };
  });
}
