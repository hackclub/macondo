import { and, desc, gte, inArray } from "drizzle-orm";

import db from "../../../db";
import {
  npsInsightsTable,
  npsResponseTable,
  supportTicketTable,
} from "../../../db/schema";
import { anonymizeFeedback } from "../../../lib/anonymize-feedback";
import { aiChat, getDefaultAiModel } from "../../../lib/hackclub-ai";
import { canAccessInternalStats } from "../../../policies/internal";

const MAX_FIELD_CHARS = 1000;

type InsightsJson = {
  improvements: unknown;
  concerns: unknown;
  positives: unknown;
};

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return "";
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0)
    .slice(0, 10);
}

function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | { roles?: string[] | null }
    | null
    | undefined;

  const cronHeader = getHeader(event, "x-cron-token");
  const cronSecret = process.env.NUXT_CRON_SECRET || process.env.CRON_SECRET;
  const userAllowed =
    actor != null &&
    canAccessInternalStats(actor as Parameters<typeof canAccessInternalStats>[0]);

  if (!(cronSecret && cronHeader && cronHeader === cronSecret) && !userAllowed) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [npsRows, ticketRows] = await Promise.all([
    db
      .select({
        score: npsResponseTable.score,
        doing_well: npsResponseTable.doing_well,
        can_improve: npsResponseTable.can_improve,
        anything_else: npsResponseTable.anything_else,
      })
      .from(npsResponseTable)
      .where(gte(npsResponseTable.created_at, windowStart))
      .orderBy(desc(npsResponseTable.created_at)),
    db
      .select({
        subject: supportTicketTable.subject,
        body: supportTicketTable.body,
        category: supportTicketTable.category,
        priority: supportTicketTable.priority,
      })
      .from(supportTicketTable)
      .where(
        and(
          gte(supportTicketTable.created_at, windowStart),
          inArray(supportTicketTable.status, ["open", "claimed"]),
        ),
      )
      .orderBy(desc(supportTicketTable.created_at))
      .limit(50), // max recent tickets in the prompt
  ]);

  const responseCount = npsRows.length;
  const ticketCount = ticketRows.length;

  let npsScore: number | null = null;
  if (responseCount > 0) {
    let promoters = 0;
    let detractors = 0;
    for (const row of npsRows) {
      if (row.score >= 9) promoters++;
      else if (row.score <= 6) detractors++;
    }
    npsScore = Math.round(((promoters - detractors) / responseCount) * 100);
  }

  const generatedForDate = todayUtcYmd();

  if (responseCount === 0 && ticketCount === 0) {
    await db
      .insert(npsInsightsTable)
      .values({
        generated_for_date: generatedForDate,
        window_start: windowStart,
        window_end: windowEnd,
        response_count: 0,
        ticket_count: 0,
        nps_score: null,
        improvements: [],
        concerns: [],
        positives: [],
        raw_ai_response: null,
        model: null,
      })
      .onConflictDoUpdate({
        target: npsInsightsTable.generated_for_date,
        set: {
          window_start: windowStart,
          window_end: windowEnd,
          response_count: 0,
          ticket_count: 0,
          nps_score: null,
          improvements: [],
          concerns: [],
          positives: [],
          raw_ai_response: null,
          model: null,
          created_at: new Date(),
        },
      });

    return {
      ok: true,
      responseCount: 0,
      ticketCount: 0,
      generatedForDate,
      skipped: true,
    };
  }

  const npsSection = npsRows
    .map((r, i) => {
      const extra = r.anything_else
        ? `\n  Anything else: ${truncate(anonymizeFeedback(r.anything_else), MAX_FIELD_CHARS)}`
        : "";
      return `#${i + 1} (score ${r.score}/10)\n  Doing well: ${truncate(anonymizeFeedback(r.doing_well), MAX_FIELD_CHARS)}\n  Could improve: ${truncate(anonymizeFeedback(r.can_improve), MAX_FIELD_CHARS)}${extra}`;
    })
    .join("\n\n");

  const ticketSection = ticketRows
    .map(
      (t, i) =>
        `#${i + 1} [${t.category}/${t.priority}] ${truncate(anonymizeFeedback(t.subject), 200)}\n  ${truncate(anonymizeFeedback(t.body), 500)}`, // ticket body char cap
    )
    .join("\n\n");

  const systemPrompt = `You analyze product feedback for Macondo, a youth coding program where teenagers build personal projects and earn rewards. You will receive recent NPS feedback plus recent support tickets. Output strict JSON with keys "improvements", "concerns", "positives". Each value is an array of 3-5 short bullet strings (max ~20 words each). Be specific, cite common themes, avoid repetition. "concerns" should highlight anything safety, payment, data-loss, or moderation related. Respond with ONLY the JSON object, no markdown fencing, no prose.`;

  const userMessage = `=== NPS FEEDBACK (${responseCount}) ===\n${npsSection || "(none)"}\n\n=== RECENT SUPPORT TICKETS (${ticketCount}) ===\n${ticketSection || "(none)"}\n\nReturn JSON only.`;

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;

  if (!aiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: "AI service not configured",
    });
  }

  let rawContent = "";
  try {
    rawContent = ((await aiChat<{
      choices: { message: { content: string } }[];
    }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 800,
        temperature: 0.3,
      },
    })).choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("[nps-insights] AI call failed", err);
    throw createError({
      statusCode: 502,
      statusMessage: "AI request failed",
    });
  }

  let improvements: string[] = [];
  let concerns: string[] = [];
  let positives: string[] = [];

  const jsonText = (() => {
    const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1]!.trim();
    const start = rawContent.indexOf("{");
    const end = rawContent.lastIndexOf("}");
    if (start >= 0 && end > start) return rawContent.slice(start, end + 1);
    return rawContent;
  })();

  try {
    const parsed = JSON.parse(jsonText) as InsightsJson;
    improvements = coerceStringArray(parsed.improvements);
    concerns = coerceStringArray(parsed.concerns);
    positives = coerceStringArray(parsed.positives);
  } catch (err) {
    console.warn("[nps-insights] JSON parse failed, storing raw", err);
  }

  await db
    .insert(npsInsightsTable)
    .values({
      generated_for_date: generatedForDate,
      window_start: windowStart,
      window_end: windowEnd,
      response_count: responseCount,
      ticket_count: ticketCount,
      nps_score: npsScore,
      improvements,
      concerns,
      positives,
      raw_ai_response: rawContent,
      model: getDefaultAiModel(),
    })
    .onConflictDoUpdate({
      target: npsInsightsTable.generated_for_date,
      set: {
        window_start: windowStart,
        window_end: windowEnd,
        response_count: responseCount,
        ticket_count: ticketCount,
        nps_score: npsScore,
        improvements,
        concerns,
        positives,
        raw_ai_response: rawContent,
        model: getDefaultAiModel(),
        created_at: new Date(),
      },
    });

  return {
    ok: true,
    generatedForDate,
    responseCount,
    ticketCount,
    npsScore,
    improvements,
    concerns,
    positives,
    parsedOk: improvements.length + concerns.length + positives.length > 0,
  };
});
