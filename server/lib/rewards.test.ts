// Imports tutorial-bonus.ts directly because rewards.ts pulls in server/db and #imports.

import { describe, expect, test } from "bun:test";

import {
  TUTORIAL_BONUS_HOURS,
  computeHackatimeDeltaWithBonus,
  computeTutorialBonusHours,
  creditedHackatimeHours,
  realHackatimeHours,
} from "./tutorial-bonus";

describe("computeTutorialBonusHours", () => {
  test("returns 0 for non-guide projects regardless of earliest", () => {
    expect(
      computeTutorialBonusHours({
        projectGuide: null,
        shipId: 1,
        earliestShipId: 1,
      }),
    ).toBe(0);
    expect(
      computeTutorialBonusHours({
        projectGuide: undefined,
        shipId: 1,
        earliestShipId: 1,
      }),
    ).toBe(0);
  });

  test("returns 0 when earliestShipId is null (no ships exist yet)", () => {
    expect(
      computeTutorialBonusHours({
        projectGuide: "html",
        shipId: 5,
        earliestShipId: null,
      }),
    ).toBe(0);
  });

  test("returns TUTORIAL_BONUS_HOURS when ship is the earliest of a guide project", () => {
    expect(
      computeTutorialBonusHours({
        projectGuide: "html",
        shipId: 5,
        earliestShipId: 5,
      }),
    ).toBe(TUTORIAL_BONUS_HOURS);
  });

  test("returns 0 when ship is NOT the earliest of a guide project", () => {
    expect(
      computeTutorialBonusHours({
        projectGuide: "html",
        shipId: 7,
        earliestShipId: 5,
      }),
    ).toBe(0);
  });

  test("returns 0 for non-html guides (real reference projects earn no canned bonus)", () => {
    for (const g of ["minecraft", "usb-hub", "devboard", "flight-controller"]) {
      expect(
        computeTutorialBonusHours({ projectGuide: g, shipId: 5, earliestShipId: 5 }),
      ).toBe(0);
    }
  });
});

describe("realHackatimeHours", () => {
  test("non-guide ship: returns hackatime_hours unchanged", () => {
    expect(
      realHackatimeHours(
        { id: 1, hackatime_hours: 4.5 },
        { projectGuide: null, earliestShipId: 1 },
      ),
    ).toBe(4.5);
  });

  test("guide earliest ship: subtracts the bonus", () => {
    expect(
      realHackatimeHours(
        { id: 1, hackatime_hours: 1 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(0);
    expect(
      realHackatimeHours(
        { id: 1, hackatime_hours: 1.6 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBeCloseTo(0.6, 5);
  });

  test("guide non-earliest ship: returns unchanged", () => {
    expect(
      realHackatimeHours(
        { id: 7, hackatime_hours: 4.5 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(4.5);
  });

  test("clamps at 0 if hackatime_hours is somehow below the bonus", () => {
    expect(
      realHackatimeHours(
        { id: 1, hackatime_hours: 0 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(0);
  });

  test("treats null hackatime_hours as 0", () => {
    expect(
      realHackatimeHours(
        { id: 1, hackatime_hours: null },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(0);
  });
});

describe("computeHackatimeDeltaWithBonus", () => {

  test("(a) tutorial without hackatime -> update with hackatime: delta = full new hackatime", () => {
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 3 },
        { id: 1, hackatime_hours: 1 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(3);
  });

  test("(b) tutorial WITH hackatime linked -> update with more hackatime: delta excludes bonus", () => {
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 4.6 },
        { id: 1, hackatime_hours: 1.6 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBeCloseTo(4.0, 5);
  });

  test("(c) tutorial -> update without hackatime change: delta = 0", () => {
    // ship 1 had 0 real + 1 bonus = 1 stored.
    // ship 2 has 0 real + 0 bonus = 0 stored.
    // Real new work: 0 - 0 = 0 (clamped from -0).
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 0 },
        { id: 1, hackatime_hours: 1 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(0);
  });

  test("non-guide project: simple subtraction (no bonus on either side)", () => {
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 5 },
        { id: 1, hackatime_hours: 2 },
        { projectGuide: null, earliestShipId: 1 },
      ),
    ).toBe(3);
  });

  test("clamps at 0 when current real-hackatime is below previous", () => {
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 1 },
        { id: 1, hackatime_hours: 5 },
        { projectGuide: null, earliestShipId: 1 },
      ),
    ).toBe(0);
  });

  test("third ship of a guide project: bonus is on ship 1, not on ship 2 or 3", () => {
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 3, hackatime_hours: 5 },
        { id: 2, hackatime_hours: 3 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(2);
  });
});

describe("creditedHackatimeHours", () => {
  test("prefers software_override_hours (the reviewer-credited hours)", () => {
    // Real prod numbers from project 2722, ship #906: the raw snapshot was
    // resnapshotted up to 18.79 during review, but only 16.53 was credited.
    expect(
      creditedHackatimeHours({
        hackatime_hours: 18.79,
        software_override_hours: 16.53,
      }),
    ).toBe(16.53);
  });

  test("falls back to hackatime_hours when software_override_hours is null", () => {
    expect(
      creditedHackatimeHours({ hackatime_hours: 10, software_override_hours: null }),
    ).toBe(10);
  });

  test("falls back to hackatime_hours when software_override_hours is omitted (legacy)", () => {
    expect(creditedHackatimeHours({ hackatime_hours: 10 })).toBe(10);
  });

  test("respects an explicit 0 credit (pure-journal software ship), not a fallback", () => {
    expect(
      creditedHackatimeHours({ hackatime_hours: 10, software_override_hours: 0 }),
    ).toBe(0);
  });

  test("returns 0 when both are null", () => {
    expect(
      creditedHackatimeHours({ hackatime_hours: null, software_override_hours: null }),
    ).toBe(0);
  });
});

describe("computeHackatimeDeltaWithBonus baselines on credited hours", () => {
  test("recovers the review-window gap (project 2722 scenario)", () => {
    // Raw 18.79 but credited 16.53; the next ship is still at 18.79.
    // A raw baseline gives 0; the credited one keeps 2.26 review-window hours claimable.
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 18.79 },
        { id: 1, hackatime_hours: 18.79, software_override_hours: 16.53 },
        { projectGuide: null, earliestShipId: 1 },
      ),
    ).toBeCloseTo(2.26, 2);
  });

  test("divergence: subtracts credited (500), not the raw snapshot (600)", () => {
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 620 },
        { id: 1, hackatime_hours: 600, software_override_hours: 500 },
        { projectGuide: null, earliestShipId: 1 },
      ),
    ).toBe(120);
  });

  test("no divergence (credited == raw): behaves exactly as before", () => {
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 620 },
        { id: 1, hackatime_hours: 600, software_override_hours: 600 },
        { projectGuide: null, earliestShipId: 1 },
      ),
    ).toBe(20);
  });

  test("guide earliest ship: strips the tutorial bonus from the credited baseline", () => {
    // Credited 3 bundles the +1 tutorial bonus, so real credited = 2 and delta = 6 - 2 = 4.
    expect(
      computeHackatimeDeltaWithBonus(
        { id: 2, hackatime_hours: 6 },
        { id: 1, hackatime_hours: 5, software_override_hours: 3 },
        { projectGuide: "html", earliestShipId: 1 },
      ),
    ).toBe(4);
  });
});
