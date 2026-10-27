export const SHIP_MAX_AGE_EXCLUSIVE = 19; // must be < 19, so 18 is the last eligible age

export function parseIsoBirthday(birthday: string | null | undefined): Date | null {
  if (!birthday || typeof birthday !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  // UTC midnight; age math is calendar-based so timezone drift only matters on the birthday itself.
  const d = new Date(`${birthday}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

// Calendar arithmetic in UTC, not ms subtraction, so the age is the same regardless of server timezone.
export function computeAgeYears(
  birthday: string | Date | null | undefined,
  asOf: Date = new Date(),
): number | null {
  const dob =
    birthday instanceof Date ? birthday : parseIsoBirthday(birthday ?? null);
  if (!dob) return null;
  const yearDiff = asOf.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthdayThisYear =
    asOf.getUTCMonth() < dob.getUTCMonth() ||
    (asOf.getUTCMonth() === dob.getUTCMonth() &&
      asOf.getUTCDate() < dob.getUTCDate());
  return beforeBirthdayThisYear ? yearDiff - 1 : yearDiff;
}

// The SHIP_MAX_AGE_EXCLUSIVE-th birthday; that day itself is already ineligible. Feb-29 rolls to Mar-1.
export function ageOutUtcDay(birthday: string | null | undefined): string | null {
  const dob = parseIsoBirthday(birthday);
  if (!dob) return null;
  const d = new Date(dob);
  d.setUTCFullYear(d.getUTCFullYear() + SHIP_MAX_AGE_EXCLUSIVE);
  return d.toISOString().slice(0, 10);
}

// Missing birthday passes: the upstream HCA verification gate rejects missing DOBs.
export function isShipEligibleByAge(
  birthday: string | Date | null | undefined,
  asOf: Date = new Date(),
): boolean {
  const age = computeAgeYears(birthday, asOf);
  if (age === null) return true;
  return age < SHIP_MAX_AGE_EXCLUSIVE;
}
