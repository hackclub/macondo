import { and, desc, eq, gt, inArray } from "drizzle-orm";

import db from "../db";
import { journalsTable, shipTable } from "../db/schema";
import { writeAudit } from "./audit";
import { aiChat, getDefaultAiModel, type ChatCompletionResponse } from "./hackclub-ai";
import { getPreviousShipDeltaBaseline } from "./ship-submit-time-hours";

async function collectUpdateDiff(shipId: number): Promise<{
  previousShipId: number;
  previousHackatimeHours: number;
  currentHackatimeHours: number;
  newJournals: Array<{
    id: number;
    short_brief: string;
    long_brief: string;
    hours: number | null;
    created_at: Date | null;
  }>;
} | null> {
  const [current] = await db
    .select({
      id: shipTable.id,
      project_id: shipTable.project_id,
      hackatime_hours: shipTable.hackatime_hours,
      reviewed_at: shipTable.reviewed_at,
      created_at: shipTable.created_at,
    })
    .from(shipTable)
    .where(eq(shipTable.id, shipId))
    .limit(1);
  if (!current) return null;

  const [previous] = await db
    .select({
      id: shipTable.id,
      user_id: shipTable.user_id,
      project_id: shipTable.project_id,
      hackatime_projects: shipTable.hackatime_projects,
      hackatime_hours: shipTable.hackatime_hours,
      software_override_hours: shipTable.software_override_hours,
      reviewed_at: shipTable.reviewed_at,
      created_at: shipTable.created_at,
    })
    .from(shipTable)
    .where(
      and(
        eq(shipTable.project_id, current.project_id),
        inArray(shipTable.status, ["shipped", "shipped_missing_airtable"]),
      ),
    )
    // must match airtable.ts delta-hours ordering so both pick the same baseline
    .orderBy(desc(shipTable.created_at), desc(shipTable.id))
    .limit(1);

  if (!previous || previous.id === current.id) return null;

  const cutoff = previous.reviewed_at ?? previous.created_at;
  if (!cutoff) return null;

  return {
    previousShipId: previous.id,
    // neither the resnapshotted nor the credited hours is the right baseline; see ship-submit-time-hours.ts
    previousHackatimeHours: await getPreviousShipDeltaBaseline(previous),
    currentHackatimeHours: current.hackatime_hours ?? 0,
    newJournals: await db
      .select({
        id: journalsTable.id,
        short_brief: journalsTable.short_brief,
        long_brief: journalsTable.long_brief,
        hours: journalsTable.hours,
        created_at: journalsTable.created_at,
      })
      .from(journalsTable)
      .where(
        and(
          eq(journalsTable.project_id, current.project_id),
          eq(journalsTable.archived, false),
          gt(journalsTable.created_at, cutoff),
        ),
      ),
  };
}

// audit is skipped without actorId because audit_logs.actor_id is NOT NULL
export async function generateUpdateShipSummary(
  shipId: number,
  actorId?: string | null,
): Promise<string | null> {
  const diff = await collectUpdateDiff(shipId);
  if (!diff) return null;

  const hackatimeDelta = Math.max(
    0,
    diff.currentHackatimeHours - diff.previousHackatimeHours,
  );
  const journalBlurb = diff.newJournals
    .map((j) => {
      const hours = j.hours != null ? `${j.hours}h` : "no hours";
      return `- (${hours}) ${j.short_brief}: ${j.long_brief.slice(0, 500)}`;
    })
    .join("\n");

  const fallback = [
    `Update ship: +${hackatimeDelta}h hackatime, ${diff.newJournals.length} new journal(s) since ship #${diff.previousShipId}.`,
    diff.newJournals.length > 0 ? journalBlurb : null,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const config = useRuntimeConfig();
    const aiKey = config.hackclubAiKey as string | undefined;
    const prompt = `You are summarising an "update ship" on a Hack Club hardware/software project for the reviewer. The student already submitted an earlier ship that was approved. This new ship represents the work they did after that first approval.

CONTEXT:
- Hackatime hours on previous ship: ${diff.previousHackatimeHours}h
- Hackatime hours on current ship:  ${diff.currentHackatimeHours}h (delta: +${hackatimeDelta}h)
- New journals since previous ship: ${diff.newJournals.length}
${journalBlurb || "(no new journals, hackatime-only progress)"}

Write a 2-4 sentence, factual summary of what the student added on this update ship. Include the hackatime delta and the headline topics from the new journals. Do not editorialise. Do not use bullet points. Output plain text only.`;

    if (!aiKey) {
      console.warn("[update-summary] No hackclubAiKey configured, using fallback");
      return fallback;
    }
    const res = await aiChat<ChatCompletionResponse>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          {
            role: "system",
            content:
              "You are a terse summariser for hardware project review notes. Output plain text only, 2-4 sentences.",
          },
          { role: "user", content: prompt },
        ],
      },
    });

    const summary = res?.choices?.[0]?.message?.content?.trim();
    const resolved = summary && summary.length > 0 ? summary : fallback;
    if (actorId) {
      try {
        await writeAudit({
          actor_id: actorId,
          action: "generate_update_ship_summary",
          entity_type: "ship",
          entity_id: String(shipId),
          old_value: null,
          new_value: {
            source: summary && summary.length > 0 ? "ai" : "fallback",
            previous_ship_id: diff.previousShipId,
            hackatime_delta_hours: hackatimeDelta,
            new_journal_count: diff.newJournals.length,
            summary: resolved,
          },
          sensitive: false,
          public_message: `Update summary generated for ship #${shipId}`,
        });
      } catch (e) {
        console.error(
          "[update-summary] Failed to audit summary generation",
          e,
        );
      }
    }
    return resolved;
  } catch (err) {
    console.error("[update-summary] AI call failed, using fallback:", err);
    if (actorId) {
      try {
        await writeAudit({
          actor_id: actorId,
          action: "generate_update_ship_summary_failed",
          entity_type: "ship",
          entity_id: String(shipId),
          old_value: null,
          new_value: {
            error: err instanceof Error ? err.message : String(err),
            fallback,
          },
          sensitive: false,
          public_message: `Update summary AI call failed for ship #${shipId}, using deterministic fallback`,
        });
      } catch (e) {
        console.error("[update-summary] Failed to audit summary failure", e);
      }
    }
    return fallback;
  }
}
