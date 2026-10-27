import { test, expect } from "bun:test";
import { nightBlendForHour, localHourInZone, lerpHex } from "./nightBlend";

test("full day at noon", () => { expect(nightBlendForHour(12)).toBe(0); });
test("full night at 3am", () => { expect(nightBlendForHour(3)).toBe(1); });
test("full night at 22:00", () => { expect(nightBlendForHour(22)).toBe(1); });
test("dusk midpoint is partial", () => {
  const v = nightBlendForHour(19);
  expect(v).toBeGreaterThan(0.4);
  expect(v).toBeLessThan(0.6);
});
test("dawn midpoint is partial", () => {
  const v = nightBlendForHour(6);
  expect(v).toBeGreaterThan(0.4);
  expect(v).toBeLessThan(0.6);
});
test("hour wraps past 24", () => { expect(nightBlendForHour(26)).toBe(nightBlendForHour(2)); });
test("localHourInZone resolves UTC noon", () => {
  const h = localHourInZone(new Date("2026-06-17T12:00:00Z"), "UTC");
  expect(h).toBeGreaterThanOrEqual(11.9);
  expect(h).toBeLessThanOrEqual(12.1);
});
test("localHourInZone tolerates a bad zone", () => {
  const h = localHourInZone(new Date("2026-06-17T12:00:00Z"), "Not/AZone");
  expect(h).toBeGreaterThanOrEqual(0);
  expect(h).toBeLessThan(24);
});
test("lerpHex endpoints", () => {
  expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000");
  expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff");
});
