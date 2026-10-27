// Fills only fields that are empty in Airtable; never overwrites existing data.
// Screenshot has its own flow because Airtable's URL fetcher silently drops unreachable attachments.

import { and, eq, inArray, isNotNull, isNull, or, sql as drizzleSql } from "drizzle-orm";

import db from "../db";
import {
  piiLockerTable,
  projectTable,
  shipTable,
  users,
} from "../db/schema";
import {
  getAirtableRecordHealth,
  isUrlReachable,
  resolveScreenshotUrlForShip,
  uploadScreenshotBytes,
  verifyScreenshotPresent,
} from "./airtable";
import { parseRepositoryUrl } from "./github";
import {
  type HackClubAuthAddress,
  isShippableField,
  pickPrimaryAddress,
} from "./locker";
import { translateDescriptionToEnglish } from "./translate-description";
import { useRuntimeConfig } from "#imports";
import { AIRTABLE_API_URL } from "./api-urls";

// Kept local so an airtable.ts refactor can't point the repair at the wrong base.
const AIRTABLE_BASE_ID = "appYYPWFXz9IhZO03";
const AIRTABLE_TABLE_ID = "tbl0FTDHEq369oijK";

// Screenshot excluded: it needs reachability checks and a byte-upload fallback.
const REPAIRABLE_FIELDS = [
  "First Name",
  "Last Name",
  "Email",
  "GitHub Username",
  "Slack ID",
  "Address (Line 1)",
  "Address (Line 2)",
  "City",
  "State / Province",
  "ZIP / Postal Code",
  "Country",
  "Birthday",
  "Description",
] as const;

type RepairableField = (typeof REPAIRABLE_FIELDS)[number];

type AirtableRecord = {
  id: string;
  fields: Record<string, unknown>;
};

type PiiAddress = HackClubAuthAddress;

export type ScreenshotFailure = {
  shipId: number;
  recordId: string;
  projectName: string | null;
  userEmail: string | null;
  thumbnailUrl: string | null;
  reason:
    | "no_url"
    | "url_dead"
    | "verify_failed"
    | "byte_upload_failed";
  status?: number | null;
  detail?: string;
};

export type AirtableRepairResult = {
  scanned: number;
  repaired: number;
  alreadyComplete: number;
  recordMissing: number;
  errors: number;
  fieldFillCounts: Record<string, number>;
  screenshotByteUploadAttempted: number;
  screenshotByteUploadSucceeded: number;
  screenshotsRecovered: number;
  promoted: number;
  deadScreenshots: ScreenshotFailure[];
};

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function buildRepairPayload(
  airtableFields: Record<string, unknown>,
  ctx: {
    project: typeof projectTable.$inferSelect;
    user: typeof users.$inferSelect;
    address: PiiAddress | null;
    birthday: string | null;
  },
): { fields: Record<string, unknown>; filled: RepairableField[] } | null {
  const repaired: Record<string, unknown> = {};
  const filled: RepairableField[] = [];

  function tryFill(field: RepairableField, value: unknown): void {
    if (!isMissing(airtableFields[field])) return;
    if (isMissing(value)) return;
    repaired[field] = value;
    filled.push(field);
  }

  // Shippable check on both sides: an Airtable "." counts as missing, and we never PATCH garbage over garbage.
  function tryFillAddress(
    field: RepairableField,
    value: unknown,
    minAlphanumeric: number,
  ): void {
    if (isShippableField(airtableFields[field], minAlphanumeric)) return;
    if (!isShippableField(value, minAlphanumeric)) return;
    repaired[field] = String(value).trim();
    filled.push(field);
  }

  const [firstFromName = "", ...rest] = (ctx.user.name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  tryFill("First Name", firstFromName);
  tryFill("Last Name", rest.join(" "));
  tryFill("Email", ctx.user.email);
  tryFill("GitHub Username", parseRepositoryUrl(ctx.project.repository_url)?.owner ?? "");
  tryFill("Slack ID", ctx.user.slack_id);
  tryFillAddress("Address (Line 1)", ctx.address?.line_1, 2);
  tryFillAddress("Address (Line 2)", ctx.address?.line_2, 1);
  tryFillAddress("City", ctx.address?.city, 2);
  tryFillAddress("State / Province", ctx.address?.state, 1);
  tryFillAddress("ZIP / Postal Code", ctx.address?.postal_code, 2);
  tryFillAddress("Country", ctx.address?.country, 2);
  tryFill("Description", ctx.project.description);

  if (ctx.birthday && /^\d{4}-\d{2}-\d{2}$/.test(ctx.birthday)) {
    tryFill("Birthday", ctx.birthday);
  }

  if (filled.length === 0) return null;
  return { fields: repaired, filled };
}

type ScreenshotRepairOutcome =
  | { ok: true; mode: "noop" }
  | { ok: true; mode: "url" | "bytes" }
  | { ok: false; failure: ScreenshotFailure };

async function repairScreenshot(args: {
  shipId: number;
  recordId: string;
  airtableFields: Record<string, unknown>;
  thumbnailUrl: string | null;
  projectName: string | null;
  userEmail: string | null;
  airtableToken: string;
  cdnKey: string | undefined;
}): Promise<ScreenshotRepairOutcome> {
  if (!isMissing(args.airtableFields["Screenshot"])) {
    return { ok: true, mode: "noop" };
  }

  // Soft failure so the Slack summary lists it; the next cron tick retries after a re-upload.
  if (!args.thumbnailUrl) {
    return {
      ok: false,
      failure: {
        shipId: args.shipId,
        recordId: args.recordId,
        projectName: args.projectName,
        userEmail: args.userEmail,
        thumbnailUrl: null,
        reason: "no_url",
      },
    };
  }

  // Try the cheap URL PATCH first since it doesn't move bytes through our server.
  const anonReach = await isUrlReachable(args.thumbnailUrl);
  if (anonReach.ok) {
    try {
      await $fetch(
        `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${args.recordId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${args.airtableToken}`,
            "Content-Type": "application/json",
          },
          body: {
            fields: { Screenshot: [{ url: args.thumbnailUrl }] },
          },
        },
      );
      if (await verifyScreenshotPresent(args.recordId, args.airtableToken)) {
        return { ok: true, mode: "url" };
      }
    } catch (err) {
      console.warn(
        "[airtable-repair] URL PATCH failed for ship",
        args.shipId,
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    console.warn(
      `[airtable-repair] thumbnail unreachable, ship #${args.shipId}, status=${anonReach.status ?? "?"}, url=${args.thumbnailUrl}`,
    );
  }

  // The URL may still be readable with a CDN bearer Airtable can't supply; without a CDN key it would fail the same way.
  if (!args.cdnKey) {
    return {
      ok: false,
      failure: {
        shipId: args.shipId,
        recordId: args.recordId,
        projectName: args.projectName,
        userEmail: args.userEmail,
        thumbnailUrl: args.thumbnailUrl,
        reason: anonReach.ok ? "verify_failed" : "url_dead",
        status: anonReach.ok ? null : anonReach.status,
      },
    };
  }

  const upload = await uploadScreenshotBytes({
    recordId: args.recordId,
    thumbnailUrl: args.thumbnailUrl,
    airtableToken: args.airtableToken,
    cdnKey: args.cdnKey,
  });

  if (upload.ok) {
    console.info(
      `[airtable-repair] byte-upload succeeded, ship #${args.shipId}, size=${upload.size} mime=${upload.mime}`,
    );
    return { ok: true, mode: "bytes" };
  }

  console.warn(
    `[airtable-repair] byte-upload failed, ship #${args.shipId}, reason=${upload.reason} status=${upload.status ?? "?"} detail=${upload.detail ?? ""}`,
  );

  return {
    ok: false,
    failure: {
      shipId: args.shipId,
      recordId: args.recordId,
      projectName: args.projectName,
      userEmail: args.userEmail,
      thumbnailUrl: args.thumbnailUrl,
      reason:
        upload.reason === "fetch_failed"
          ? "url_dead"
          : upload.reason === "verify_failed"
            ? "verify_failed"
            : "byte_upload_failed",
      status: upload.status ?? (anonReach.ok ? null : anonReach.status),
      detail: upload.detail,
    },
  };
}

export async function runAirtableRepair(): Promise<AirtableRepairResult> {
  const config = useRuntimeConfig();
  const token = config.airtableToken as string | undefined;
  const cdnKey = config.hackclubCdnKey as string | undefined;

  const result: AirtableRepairResult = {
    scanned: 0,
    repaired: 0,
    alreadyComplete: 0,
    recordMissing: 0,
    errors: 0,
    fieldFillCounts: {},
    screenshotByteUploadAttempted: 0,
    screenshotByteUploadSucceeded: 0,
    screenshotsRecovered: 0,
    promoted: 0,
    deadScreenshots: [],
  };

  if (!token) {
    console.warn("[airtable-repair] skipped: no AIRTABLE_TOKEN configured");
    return result;
  }

  // Reverted ships keep a stale airtable_record_id, so the status filter excludes them.
  // Bounded per tick; `shipped_missing_airtable` rows bypass the recency window so a broken screenshot is retried every tick.
  const ships = await db
    .select({
      ship_id: shipTable.id,
      airtable_record_id: shipTable.airtable_record_id,
      project_id: shipTable.project_id,
      user_id: shipTable.user_id,
      status: shipTable.status,
    })
    .from(shipTable)
    .where(
      and(
        isNotNull(shipTable.airtable_record_id),
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
        or(
          eq(shipTable.status, "shipped_missing_airtable"),
          isNull(shipTable.last_airtable_repair_at),
          drizzleSql`${shipTable.last_airtable_repair_at} < now() - interval '7 days'`,
        ),
      ),
    )
    .orderBy(drizzleSql`${shipTable.last_airtable_repair_at} asc nulls first`)
    .limit(50); // ships repaired per tick

  const projectIds = [...new Set(ships.map((s) => s.project_id))];
  const userIds = [...new Set(ships.map((s) => s.user_id))];
  const projectsById = new Map<number, typeof projectTable.$inferSelect>();
  const usersById = new Map<string, typeof users.$inferSelect>();
  const lockersByUserId = new Map<string, typeof piiLockerTable.$inferSelect>();
  if (projectIds.length > 0) {
    for (const p of await db
      .select()
      .from(projectTable)
      .where(inArray(projectTable.id, projectIds))) {
      projectsById.set(p.id, p);
    }
  }
  if (userIds.length > 0) {
    for (const u of await db.select().from(users).where(inArray(users.id, userIds))) {
      usersById.set(u.id, u);
    }
    for (const l of await db
      .select()
      .from(piiLockerTable)
      .where(inArray(piiLockerTable.user_id, userIds))) {
      lockersByUserId.set(l.user_id, l);
    }
  }

  for (const ship of ships) {
    if (!ship.airtable_record_id) continue;
    result.scanned++;

    try {
      // Live GET rather than a snapshot because reviewers edit rows by hand.
      let record: AirtableRecord | null = null;
      try {
        record = await $fetch<AirtableRecord>(
          `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${ship.airtable_record_id}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
      } catch (err) {
        const status = (err as { statusCode?: number; status?: number }).statusCode
          ?? (err as { statusCode?: number; status?: number }).status;
        // Airtable returns 403, not 404, for a deleted record when the token lacks list-records scope.
        if (status === 404 || status === 403) {
          console.warn(
            `[airtable-repair] ship #${ship.ship_id} airtable record ${ship.airtable_record_id} no longer exists or is inaccessible (HTTP ${status})`,
          );
          result.recordMissing++;
          continue;
        }
        throw err;
      }

      if (!record) {
        result.recordMissing++;
        continue;
      }

      const project = projectsById.get(ship.project_id);
      const user = usersById.get(ship.user_id);
      const locker = lockersByUserId.get(ship.user_id);

      if (!project || !user) {
        result.recordMissing++;
        continue;
      }

      const address = pickPrimaryAddress(locker?.addresses);

      const payload = buildRepairPayload(record.fields, {
        project: {
          ...project,
          description: await translateDescriptionToEnglish(project.description ?? ""),
        },
        user,
        address,
        birthday: locker?.birthday ?? null,
      });

      let didAnything = false;

      if (payload) {
        await $fetch(
          `${AIRTABLE_API_URL}/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${ship.airtable_record_id}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: { fields: payload.fields },
          },
        );
        didAnything = true;
        for (const field of payload.filled) {
          result.fieldFillCounts[field] = (result.fieldFillCounts[field] ?? 0) + 1;
        }
        console.info(
          `[airtable-repair] patched ${ship.airtable_record_id} (ship #${ship.ship_id}) filled=${payload.filled.join(",")}`,
        );
      }

      const screenshotOutcome = await repairScreenshot({
        shipId: ship.ship_id,
        recordId: ship.airtable_record_id,
        airtableFields: record.fields,
        // Hardware ships fall back to the latest journal's first attachment when the thumbnail is missing or unreachable.
        thumbnailUrl: await resolveScreenshotUrlForShip(project, ship.ship_id),
        projectName: project.name,
        userEmail: user.email,
        airtableToken: token,
        cdnKey,
      });

      if (screenshotOutcome.ok && screenshotOutcome.mode !== "noop") {
        didAnything = true;
        result.screenshotsRecovered++;
        result.fieldFillCounts["Screenshot"] =
          (result.fieldFillCounts["Screenshot"] ?? 0) + 1;
        if (screenshotOutcome.mode === "bytes") {
          result.screenshotByteUploadAttempted++;
          result.screenshotByteUploadSucceeded++;
        }
      } else if (!screenshotOutcome.ok) {
        if (
          screenshotOutcome.failure.reason === "byte_upload_failed" ||
          screenshotOutcome.failure.reason === "verify_failed"
        ) {
          result.screenshotByteUploadAttempted++;
        }
        result.deadScreenshots.push(screenshotOutcome.failure);
      }

      if (didAnything) {
        result.repaired++;
      } else if (!screenshotOutcome.ok) {
        // Still broken: counts as neither repaired nor alreadyComplete.
      } else {
        result.alreadyComplete++;
      }

      // Re-GET because Airtable can return 200 on a PATCH yet drop the Screenshot.
      if (
        ship.status === "shipped_missing_airtable" &&
        screenshotOutcome.ok
      ) {
        const health = await getAirtableRecordHealth(ship.airtable_record_id);
        if (health.state === "ok") {
          await db
            .update(shipTable)
            .set({ status: "shipped" })
            .where(eq(shipTable.id, ship.ship_id));
          result.promoted++;
          console.info(
            `[airtable-repair] promoted ship #${ship.ship_id} from shipped_missing_airtable to shipped`,
          );
        } else if (health.state === "missing_fields") {
          console.info(
            `[airtable-repair] ship #${ship.ship_id} still missing ${health.missing.join(", ")}; leaving in shipped_missing_airtable`,
          );
        }
      }
    } catch (err) {
      result.errors++;
      console.error("[airtable-repair] ship failed", ship.ship_id, err);
    }
  }

  // Errored/missing rows are stamped too so a deleted record isn't re-hit every tick;
  // broken `shipped_missing_airtable` rows stay eligible via the status filter.
  if (ships.length > 0) {
    await db
      .update(shipTable)
      .set({ last_airtable_repair_at: drizzleSql`now()` })
      .where(
        inArray(
          shipTable.id,
          ships.map((s) => s.ship_id),
        ),
      );
  }

  return result;
}
