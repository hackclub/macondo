import { and, desc, gte, lte } from "drizzle-orm";
import db from "../../../db";
import { npsInsightsTable } from "../../../db/schema";
import { canAccessInternalStats } from "../../../policies/internal";

// generated_for_date is a YYYY-MM-DD varchar, so string comparison orders dates correctly.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type NpsInsightItem = {
  generatedForDate: string;
  windowStart: string;
  windowEnd: string;
  responseCount: number;
  ticketCount: number;
  npsScore: number | null;
  improvements: string[];
  concerns: string[];
  positives: string[];
  model: string | null;
  createdAt: string;
};

export type NpsInsightsResponse = {
  items: NpsInsightItem[];
};

export default defineEventHandler(async (event): Promise<NpsInsightsResponse> => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalStats(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const from =
    typeof query.from === "string" && DAY_RE.test(query.from) ? query.from : null;
  const to =
    typeof query.to === "string" && DAY_RE.test(query.to) ? query.to : null;
  if (!from || !to || from > to) {
    throw createError({
      statusCode: 400,
      statusMessage: "from and to must be YYYY-MM-DD dates with from <= to",
    });
  }

  const rows = await db
    .select({
      generated_for_date: npsInsightsTable.generated_for_date,
      window_start: npsInsightsTable.window_start,
      window_end: npsInsightsTable.window_end,
      response_count: npsInsightsTable.response_count,
      ticket_count: npsInsightsTable.ticket_count,
      nps_score: npsInsightsTable.nps_score,
      improvements: npsInsightsTable.improvements,
      concerns: npsInsightsTable.concerns,
      positives: npsInsightsTable.positives,
      model: npsInsightsTable.model,
      created_at: npsInsightsTable.created_at,
    })
    .from(npsInsightsTable)
    .where(
      and(
        gte(npsInsightsTable.generated_for_date, from),
        lte(npsInsightsTable.generated_for_date, to),
      ),
    )
    .orderBy(desc(npsInsightsTable.generated_for_date))
    .limit(120);

  return {
    items: rows.map((row) => ({
      generatedForDate: row.generated_for_date,
      windowStart:
        row.window_start instanceof Date
          ? row.window_start.toISOString()
          : String(row.window_start),
      windowEnd:
        row.window_end instanceof Date
          ? row.window_end.toISOString()
          : String(row.window_end),
      responseCount: Number(row.response_count ?? 0),
      ticketCount: Number(row.ticket_count ?? 0),
      npsScore: row.nps_score == null ? null : Number(row.nps_score),
      improvements: row.improvements ?? [],
      concerns: row.concerns ?? [],
      positives: row.positives ?? [],
      model: row.model,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    })),
  };
});
