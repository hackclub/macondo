// Shared event deadlines have no DB/Nuxt dependencies.

// -04:00 because Eastern is on daylight time in August.
export const SHIP_DEADLINE_MS = Date.parse("2026-08-23T23:59:00-04:00");

// Extension cohort: extension-form students plus staff-confirmed IRL attendees.
export const SHIP_EXTENSION_DEADLINE_MS = Date.parse(
  "2026-08-31T23:59:00-04:00",
);

// Last participant deadline. Staff reviews and fulfillment continue afterward.
export const MACONDO_END_MS = SHIP_EXTENSION_DEADLINE_MS;

// True once the event is over. Takes `now` so callers can be tested without
// mocking the clock.
export function macondoHasEnded(now: number = Date.now()): boolean {
  return now > MACONDO_END_MS;
}
