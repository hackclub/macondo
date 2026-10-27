// Imports the pure template module so the test loads without #imports / db.

import { describe, expect, test } from "bun:test";

import {
  formatEvidenceWindow,
  formatJustificationTemplate,
} from "./airtable-justification";

function base(overrides: Record<string, unknown> = {}) {
  return {
    shipId: 1,
    projectId: 2,
    decisionAuditNotes: "looks good",
    overrideReason: null,
    reviewerName: "Nathan",
    reviewedAt: new Date("2026-07-22T00:00:00Z"),
    ...overrides,
  } as Parameters<typeof formatJustificationTemplate>[0];
}

describe("formatEvidenceWindow", () => {
  test("renders M/D/YYYY in UTC on both ends", () => {
    expect(
      formatEvidenceWindow(
        new Date("2026-07-05T00:00:00Z"),
        new Date("2026-07-22T00:00:00Z"),
      ),
    ).toBe("7/5/2026-7/22/2026");
  });

  test("a late-UTC-day timestamp does not roll into the next day", () => {
    // A 23:30Z stamp read in UTC+2 would print as the next day.
    expect(
      formatEvidenceWindow(null, new Date("2026-07-22T23:30:00Z")),
    ).toBe("up to 7/22/2026");
  });

  test("unknown end yields null rather than a guessed range", () => {
    expect(formatEvidenceWindow(new Date("2026-07-05T00:00:00Z"), null)).toBeNull();
  });
});

describe("formatJustificationTemplate handbook coverage", () => {
  test("ARI justification block populates every reviewer-written section", () => {
    const out = formatJustificationTemplate(
      base({
        ariTechnicalFeatures: "OAuth login, self-hosted Postgres",
        ariDeflationReason: "Cut 35h to 33h: last commits are README edits",
        ariHackatimeProjects: "portfolio 7/5/2026-7/22/2026",
        ariHackatimeUserId: "4821",
        ariLapseLinks: "https://lapse.hackclub.com/c/9f2a, https://lapse.hackclub.com/c/9f2b",
      }),
    );

    expect(out).toContain("[SPECIFIC TECHNICAL FEATURES]");
    expect(out).toContain("OAuth login, self-hosted Postgres");
    expect(out).toContain("[DEFLATION JUSTIFICATION]");
    expect(out).toContain("[TIMELAPSES]");
    // Comma-separated on the wire, one per line here so each is clickable.
    expect(out).toContain("\nhttps://lapse.hackclub.com/c/9f2a\n");
    expect(out).toContain("\nhttps://lapse.hackclub.com/c/9f2b\n");
    expect(out).toContain("Projects: portfolio 7/5/2026-7/22/2026");
    expect(out).toContain("User Hackatime ID: 4821");
  });

  test("ARI's own project ranges win over the derived window", () => {
    const out = formatJustificationTemplate(
      base({
        ariHackatimeProjects: "portfolio 7/5/2026-7/22/2026",
        evidenceWindowStart: new Date("2026-04-15T00:00:00Z"),
        evidenceWindowEnd: new Date("2026-07-22T00:00:00Z"),
      }),
    );
    expect(out).not.toContain("Analyzed over:");
  });

  test("a non-ARI ship still reports a date range for its projects", () => {
    const out = formatJustificationTemplate(
      base({
        hackatimeProjects: ["portfolio"],
        evidenceWindowStart: new Date("2026-04-15T00:00:00Z"),
        evidenceWindowEnd: new Date("2026-07-22T00:00:00Z"),
      }),
    );
    expect(out).toContain("Projects: portfolio");
    expect(out).toContain("Analyzed over: 4/15/2026-7/22/2026");
  });

  test("commit history reports the window and flags the fetch ceiling", () => {
    const out = formatJustificationTemplate(
      base({
        commitCount: 300,
        commitsTruncated: true,
        evidenceWindowStart: new Date("2026-04-15T00:00:00Z"),
        evidenceWindowEnd: new Date("2026-07-22T00:00:00Z"),
      }),
    );
    expect(out).toContain("300+ commit(s) over 4/15/2026-7/22/2026.");
    expect(out).toContain("capped at the 300-commit fetch ceiling");
  });

  test("a failed commit fetch omits the block instead of claiming zero", () => {
    expect(formatJustificationTemplate(base({ commitCount: null }))).not.toContain("[COMMIT HISTORY]");
  });

  test("credited hours name the total and split it by evidence source", () => {
    const out = formatJustificationTemplate(
      base({
        creditedHours: 30,
        pushedHours: 12,
        ariMinutesBreakdown: {
          hackatime: 1200,
          journals: 300,
          lapse: 0,
          program: 60,
        },
      }),
    );
    expect(out).toContain("Approved on this ship (cumulative): 30h");
    expect(out).toContain("12h");
    // Zeroed sources are dropped; the rest convert minutes to hours.
    expect(out).toContain(
      "Evidence sources: Hackatime 20h, journals 5h, program-added 1h.",
    );
    expect(out).not.toContain("timelapse");
  });

  test("submitter experience reports counts, never a verdict", () => {
    const out = formatJustificationTemplate(
      base({
        priorApprovedShips: 7,
        firstApprovedShipAt: new Date("2026-05-02T00:00:00Z"),
        projectLevel: "3",
      }),
    );
    expect(out).toContain(
      "7 previously approved ship(s) on Macondo, first on 5/2/2026.",
    );
    expect(out).toContain("Difficulty level selected for this project: 3");
    for (const verdict of ["beginner -", "intermediate", "advanced"]) {
      expect(out).not.toContain(verdict);
    }
  });

  test("a first-time maker reads as first, not as zero", () => {
    expect(formatJustificationTemplate(base({ priorApprovedShips: 0 }))).toContain(
      "First approved ship on Macondo.",
    );
  });

  test("the undeflated case is stated, not left silent", () => {
    expect(
      formatJustificationTemplate(base({ creditedHours: 30, wasDeflated: false })),
    ).toContain("No deflation applied");
  });

  test("undeflated line stays out when a deflation reason is present", () => {
    const out = formatJustificationTemplate(
      base({
        creditedHours: 30,
        wasDeflated: false,
        ariDeflationReason: "Cut 35h to 30h.",
      }),
    );
    expect(out).not.toContain("No deflation applied");
  });

  test("an uncheckable ship asserts nothing about deflation", () => {
    expect(
      formatJustificationTemplate(base({ creditedHours: 30, wasDeflated: undefined })),
    ).not.toContain("No deflation applied");
  });

  test("the split justification prompts each render their own block", () => {
    const out = formatJustificationTemplate(
      base({
        ariTimeEvidence: "Hackatime heartbeats line up with the commit times",
        ariSupportingEvidence: "Devlog screenshots show the board revisions",
        ariHoursReasoning: "33h is typical for a first four-layer PCB",
        ariAdditionalJustification: "Maker walked me through the build on a call",
      }),
    );

    expect(out).toContain("[TIME EVIDENCE]");
    expect(out).toContain("Hackatime heartbeats line up with the commit times");
    expect(out).toContain("[SUPPORTING EVIDENCE]");
    expect(out).toContain("Devlog screenshots show the board revisions");
    expect(out).toContain("[HOURS REASONING]");
    expect(out).toContain("33h is typical for a first four-layer PCB");
    expect(out).toContain("[ADDITIONAL JUSTIFICATION]");
    expect(out).toContain("Maker walked me through the build on a call");
  });

  test("the hardware unified-db write-up is carried verbatim, newlines intact", () => {
    const record = "Project: Tide Clock\nHours: 33\nEvidence: journals + lapse";
    const out = formatJustificationTemplate(base({ ariUnifiedDbRecord: record }));
    expect(out).toContain("[ARI UNIFIED DB RECORD]");
    expect(out).toContain(record);
  });

  test("a natively reviewed ship renders none of the ARI-only blocks", () => {
    const out = formatJustificationTemplate(base());
    for (const block of [
      "[SPECIFIC TECHNICAL FEATURES]",
      "[DEFLATION JUSTIFICATION]",
      "[TIME EVIDENCE]",
      "[SUPPORTING EVIDENCE]",
      "[HOURS REASONING]",
      "[ADDITIONAL JUSTIFICATION]",
      "[ARI UNIFIED DB RECORD]",
      "[TIMELAPSES]",
      "[HOURS CREDITED]",
    ]) {
      expect(out).not.toContain(block);
    }
    expect(out).toContain("[REVIEWER JUSTIFICATION]");
    expect(out).toContain("[REVIEWED BY]");
  });
});

describe("cross-YSWS overlap is flagged, never subtracted", () => {
  // Hours credited under another YSWS must only annotate the row, never cap the pushed delta.
  const withOverlap = base({
    isUpdateShip: true,
    previousShipId: 9,
    previousCumulativeHours: 20,
    cumulativeHours: 23,
    deltaHours: 3,
    crossYswsCreditedElsewhere: 23,
    crossYswsMatches: [
      {
        recordId: "recABC",
        ysws: "Flavortown",
        url: "https://github.com/x/y",
        field: "Code URL" as const,
        hours: 23,
        firstSubmittedAt: new Date("2026-04-22T00:00:00Z"),
        inWindow: true,
      },
    ],
  });

  test("the full reviewer-approved delta is still what gets pushed", () => {
    expect(formatJustificationTemplate(withOverlap)).toContain("Delta pushed to Airtable: 3h.");
  });

  test("the overlap is reported to the unified reviewer without a deduction", () => {
    const out = formatJustificationTemplate(withOverlap);
    expect(out).toContain("[UPDATE - DUPLICATE CODE URL]");
    expect(out).toContain("already credited under those programs (in-window): 23h");
    expect(out).toContain("NOT subtracted");
    expect(out).not.toContain("Dedup ceiling");
    expect(out).not.toContain("hours subtracted (sum of credited hours");
  });
});

describe("group rows cite the maker's own Hackatime evidence", () => {
  const group = {
    memberEmail: "co@example.com",
    memberHours: 12,
    others: [{ email: "owner@example.com", hours: 30 }],
  };

  test("a co-maker row renders their own id, projects and raw hours", () => {
    const out = formatJustificationTemplate(
      base({
        groupProject: group,
        hackatimeUserId: 25352,
        hackatimeProjects: ["pixl-sprites", "pixl"],
        hackatimeHours: 31.9,
        ariHackatimeUserId: null,
        ariHackatimeProjects: null,
      }),
    );
    expect(out).toContain(
      "Scope: co@example.com's own Hackatime account only",
    );
    expect(out).toContain("User Hackatime ID: 25352");
    expect(out).toContain("Projects: pixl-sprites, pixl");
    expect(out).toContain("Raw Hackatime hours (BEFORE reviewer deflation): 31.9h");
  });

  test("an unresolvable co-maker still gets the block, marked unavailable", () => {
    const out = formatJustificationTemplate(
      base({
        groupProject: group,
        hackatimeUserId: 25352,
        hackatimeProjects: null,
        hackatimeHours: null,
        hackatimeUnavailable: true,
      }),
    );
    expect(out).toContain("[HACKATIME]");
    expect(out).toContain("User Hackatime ID: 25352");
    expect(out).toContain("could not be fetched at sync time");
    expect(out).not.toContain("Raw Hackatime hours (BEFORE");
  });

  test("journals and evidence sources on a group row are scoped to the maker", () => {
    const out = formatJustificationTemplate(
      base({
        groupProject: group,
        journalHoursRaw: 6.6,
        journalHoursApproved: 6.6,
        creditedHours: 12,
        ariMinutesBreakdown: { hackatime: 111, journals: 396, lapse: 12, program: 0 },
      }),
    );
    expect(out).toContain("Scope: co@example.com's own journals only.");
    expect(out).toContain("Raw journal hours claimed (BEFORE reviewer deflation): 6.6h");
    expect(out).toContain(
      "Evidence sources (this maker): Hackatime 1.85h, journals 6.6h, timelapse 0.2h.",
    );
    expect(out).not.toContain("whole ship");
  });

  test("a co-maker row lists only their own timelapses", () => {
    const out = formatJustificationTemplate(
      base({
        groupProject: group,
        ariLapseLinks: "https://lookout.hackclub.com/api/media/a/video.mp4, https://lookout.hackclub.com/api/media/b/video.mp4",
        ariLapseLinksWholeShip: false,
      }),
    );
    expect(out).toContain("[TIMELAPSES]");
    expect(out).toContain("Scope: co@example.com's own timelapses only.");
    expect(out).toContain("https://lookout.hackclub.com/api/media/b/video.mp4");
  });

  test("an old ARI payload without a per-maker split labels the list whole-ship", () => {
    const out = formatJustificationTemplate(
      base({
        groupProject: group,
        ariLapseLinks: "https://lookout.hackclub.com/api/media/a/video.mp4",
        ariLapseLinksWholeShip: true,
      }),
    );
    expect(out).toContain("Whole-ship list: this decision predates ARI's per-maker timelapse split");
  });

  test("a co-maker with no timelapses of their own omits the block", () => {
    expect(
      formatJustificationTemplate(
        base({ groupProject: group, ariLapseLinks: null, ariLapseLinksWholeShip: false }),
      ),
    ).not.toContain("[TIMELAPSES]");
  });

  test("a solo row is unchanged: no scope line, no whole-ship labels", () => {
    const out = formatJustificationTemplate(
      base({
        hackatimeUserId: 32270,
        hackatimeHours: 10,
        journalHoursRaw: 2,
        creditedHours: 10,
        ariMinutesBreakdown: { hackatime: 600, journals: 0, lapse: 0, program: 0 },
      }),
    );
    expect(out).not.toContain("Scope:");
    expect(out).not.toContain("whole ship");
    expect(out).not.toContain("this maker");
    expect(out).toContain("Evidence sources: Hackatime 10h.");
  });
});
