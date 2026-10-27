import { describe, expect, test } from "bun:test";

import {
  TUTORIAL_BONUS_HOURS,
  buildTutorialCreditJournal,
  clampSubmitTimeHours,
  computeHackatimeDeltaWithBonus,
  loggedSubmitTimeHours,
} from "./tutorial-bonus";

describe("clampSubmitTimeHours", () => {
  test("caps at the resnapshotted hackatime snapshot", () => {
    expect(
      clampSubmitTimeHours(150.6, {
        hackatime_hours: 143.95,
        software_override_hours: 114.8,
      }),
    ).toBe(143.95);
  });

  test("floors at reviewer-credited hours for journal-heavy ships", () => {
    expect(
      clampSubmitTimeHours(12, {
        hackatime_hours: 12,
        software_override_hours: 20,
      }),
    ).toBe(20);
  });

  test("passes a value through when it sits inside both bounds", () => {
    expect(
      clampSubmitTimeHours(143.92, {
        hackatime_hours: 143.95,
        software_override_hours: 114.8,
      }),
    ).toBe(143.92);
  });

  // ship 4338: clamping at read time must recover from a stale-high cached baseline
  test("a stale-high cached value is re-bounded after the override moves", () => {
    expect(
      clampSubmitTimeHours(150.6, {
        hackatime_hours: 143.95,
        software_override_hours: 114.8,
      }),
    ).toBeLessThan(147.5);
  });

  test("skips the upper bound when the snapshot is missing", () => {
    expect(
      clampSubmitTimeHours(9.5, {
        hackatime_hours: null,
        software_override_hours: null,
      }),
    ).toBe(9.5);
  });
});

describe("loggedSubmitTimeHours", () => {
  // ship 6067: comparing live Hackatime to the team's credited hours blocked update ships forever
  test("group ship: strips the credited floor back to what the owner logged", () => {
    const groupShip = { hackatime_hours: 22.04, software_override_hours: 37 };
    expect(clampSubmitTimeHours(22.04, groupShip)).toBe(37);
    expect(loggedSubmitTimeHours(clampSubmitTimeHours(22.04, groupShip), groupShip)).toBe(22.04);
  });

  test("keeps the submit-time value when it sits under the snapshot", () => {
    expect(
      loggedSubmitTimeHours(120.5, { hackatime_hours: 143.95 }),
    ).toBe(120.5);
  });

  test("skips the ceiling when the snapshot is missing", () => {
    expect(loggedSubmitTimeHours(9.5, { hackatime_hours: null })).toBe(9.5);
  });

  // ship 6229: capping against journal-credited hours zeroed approved work and paid nothing
  test("journal-credited previous ship: cap follows logged hours, not credit", () => {
    const previous = { id: 6064, hackatime_hours: 8.18, software_override_hours: 13.3 };
    const opts = { projectGuide: null, earliestShipId: null };
    const current = { id: 6229, hackatime_hours: 11.14 };

    const credited = clampSubmitTimeHours(8.18, previous);
    expect(credited).toBe(13.3);
    expect(
      computeHackatimeDeltaWithBonus(
        current,
        { ...previous, hackatime_hours: credited, software_override_hours: null },
        opts,
      ),
    ).toBe(0);

    const logged = loggedSubmitTimeHours(credited, previous);
    expect(logged).toBe(8.18);
    expect(
      computeHackatimeDeltaWithBonus(
        current,
        { ...previous, hackatime_hours: logged, software_override_hours: null },
        opts,
      ),
    ).toBeCloseTo(2.96, 10);
  });
});

describe("buildTutorialCreditJournal", () => {
  const at = new Date("2026-06-24T08:42:58.149Z");

  test("earliest html-tutorial ship earns a 1h credit devlog", () => {
    const j = buildTutorialCreditJournal({
      projectGuide: "html",
      shipId: 3056,
      earliestShipId: 3056,
      at,
      authorEmail: "tutorial-author@example.com",
    });
    expect(j).not.toBeNull();
    expect(j!.hours).toBe(TUTORIAL_BONUS_HOURS);
    expect(j!.at).toBe(at);
    expect(j!.authorEmail).toBe("tutorial-author@example.com");
    // reviewers must see why an in-browser tutorial has no Hackatime time
    expect(j!.title.length).toBeGreaterThan(0);
    expect(j!.body.toLowerCase()).toContain("hackatime");
  });

  test("a later ship of the html-tutorial project earns nothing", () => {
    expect(
      buildTutorialCreditJournal({
        projectGuide: "html",
        shipId: 4000,
        earliestShipId: 3056,
        at,
        authorEmail: "tutorial-author@example.com",
      }),
    ).toBeNull();
  });

  test("non-html guides earn nothing (real reference projects, not a canned tutorial)", () => {
    for (const guide of ["minecraft", "usb-hub", "devboard", "flight-controller"]) {
      expect(
        buildTutorialCreditJournal({
          projectGuide: guide,
          shipId: 1,
          earliestShipId: 1,
          at,
          authorEmail: "a@b.com",
        }),
      ).toBeNull();
    }
  });

  test("a plain project (no guide) earns nothing", () => {
    expect(
      buildTutorialCreditJournal({
        projectGuide: null,
        shipId: 1,
        earliestShipId: 1,
        at,
        authorEmail: "a@b.com",
      }),
    ).toBeNull();
  });
});
