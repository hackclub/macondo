import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";

import db from "../../../db";
import {
  faqSuggestionTable,
  supportTicketMessageTable,
  supportTicketTable,
} from "../../../db/schema";
import { anonymizeFeedback } from "../../../lib/anonymize-feedback";
import { aiChat, getDefaultAiModel } from "../../../lib/hackclub-ai";
import { canManageInternalFAQ } from "../../../policies/internal";

const MAX_SUGGESTIONS = 8;
const MIN_CLUSTER_SIZE = 2;

type AiSuggestion = {
  question_en: string;
  answer_en: string;
  question_es: string;
  answer_es: string;
  source_ticket_ids: number[];
  similar_count: number;
};

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return "";
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}

function normalizeForDedup(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function coerceNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
      if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
      return null;
    })
    .filter((v): v is number => v != null)
    .slice(0, 50);
}

function stripDashes(s: string): string {
  return s.replace(/\u2014/g, ", ").replace(/--/g, ", ");
}

function coerceSuggestion(raw: unknown): AiSuggestion | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const questionEn = typeof obj.question_en === "string" ? stripDashes(obj.question_en.trim()) : "";
  const answerEn = typeof obj.answer_en === "string" ? stripDashes(obj.answer_en.trim()) : "";
  const questionEs = typeof obj.question_es === "string" ? stripDashes(obj.question_es.trim()) : "";
  const answerEs = typeof obj.answer_es === "string" ? stripDashes(obj.answer_es.trim()) : "";
  if (!questionEn || !answerEn) return null;
  const similarCount =
    typeof obj.similar_count === "number" && Number.isFinite(obj.similar_count)
      ? Math.max(1, Math.trunc(obj.similar_count))
      : 1;
  return {
    question_en: questionEn,
    answer_en: answerEn,
    question_es: questionEs || "",
    answer_es: answerEs || "",
    source_ticket_ids: coerceNumberArray(obj.source_ticket_ids),
    similar_count: similarCount,
  };
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canManageInternalFAQ(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const tickets = await db
    .select({
      id: supportTicketTable.id,
      subject: supportTicketTable.subject,
      body: supportTicketTable.body,
      category: supportTicketTable.category,
    })
    .from(supportTicketTable)
    .where(
      and(
        gte(supportTicketTable.created_at, new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000)), // 30-day lookback
        inArray(supportTicketTable.status, ["resolved", "closed"]),
      ),
    )
    .orderBy(desc(supportTicketTable.created_at))
    .limit(100);

  if (tickets.length === 0) {
    return {
      ok: true,
      ticketsAnalyzed: 0,
      suggestionsCreated: 0,
      message: "No resolved tickets in the last 30 days.",
    };
  }

  const messages = await db
    .select({
      ticket_id: supportTicketMessageTable.ticket_id,
      body: supportTicketMessageTable.body,
      is_internal_note: supportTicketMessageTable.is_internal_note,
    })
    .from(supportTicketMessageTable)
    .where(
      and(
        inArray(supportTicketMessageTable.ticket_id, tickets.map((t) => t.id)),
        eq(supportTicketMessageTable.is_internal_note, false),
      ),
    )
    .orderBy(asc(supportTicketMessageTable.created_at));

  const messagesByTicket = new Map<number, string[]>();
  for (const m of messages) {
    const list = messagesByTicket.get(m.ticket_id) ?? [];
    list.push(truncate(anonymizeFeedback(m.body), 600)); // reply char cap
    messagesByTicket.set(m.ticket_id, list);
  }

  const ticketSection = tickets
    .map((t) => {
      const replies = messagesByTicket.get(t.id) ?? [];
      return [
        `#${t.id} [${t.category}]`,
        `  Subject: ${truncate(anonymizeFeedback(t.subject), 400)}`, // subject char cap
        `  Body: ${truncate(anonymizeFeedback(t.body), 600)}`, // body char cap
        replies.length
          ? replies.map((r, i) => `  Reply ${i + 1}: ${r}`).join("\n")
          : "  (no replies)",
      ].join("\n");
    })
    .join("\n\n");

  const systemPrompt =
    `You help run Macondo, a youth coding program where teenagers (ages 13 to 18) build personal projects and earn rewards. ` +
    `You will receive recent resolved support tickets, each with the student's original question and the support team's replies. ` +
    `Cluster similar questions across tickets and produce FAQ entries that future students could find useful. ` +
    `Output strict JSON: {"suggestions":[{"question_en":"...","answer_en":"...","question_es":"...","answer_es":"...","source_ticket_ids":[1,2,3],"similar_count":N}]}. ` +
    `Rules: at most ${MAX_SUGGESTIONS} suggestions, ordered by similar_count descending; skip clusters of fewer than ${MIN_CLUSTER_SIZE} tickets; ` +
    `answers should be written for a teen audience, under 60 words, warm and direct; both languages are required for every suggestion; ` +
    `do not use em dashes or double hyphens, use commas or periods instead; ` +
    `include the ticket ids that went into each cluster in source_ticket_ids. ` +
    `Respond with ONLY the JSON object, no markdown fencing, no prose.`;

  const userMessage = `=== RESOLVED TICKETS (${tickets.length}) ===\n${ticketSection}\n\nReturn JSON only.`;

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
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      },
    });
    rawContent = (res.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("[faq-suggestions] AI call failed", err);
    throw createError({
      statusCode: 502,
      statusMessage: "AI request failed",
    });
  }

  const jsonText = (() => {
    const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1]!.trim();
    const start = rawContent.indexOf("{");
    const end = rawContent.lastIndexOf("}");
    if (start >= 0 && end > start) return rawContent.slice(start, end + 1);
    return rawContent;
  })();

  let parsed: AiSuggestion[] = [];
  try {
    const obj = JSON.parse(jsonText) as { suggestions?: unknown };
    if (Array.isArray(obj.suggestions)) {
      parsed = obj.suggestions
        .map((s) => coerceSuggestion(s))
        .filter((s): s is AiSuggestion => s !== null)
        .filter((s) => s.similar_count >= MIN_CLUSTER_SIZE);
    }
  } catch (err) {
    console.warn("[faq-suggestions] JSON parse failed", err);
  }

  parsed.sort((a, b) => b.similar_count - a.similar_count);
  parsed = parsed.slice(0, MAX_SUGGESTIONS);

  if (parsed.length === 0) {
    return {
      ok: true,
      ticketsAnalyzed: tickets.length,
      suggestionsCreated: 0,
      rawResponse: rawContent,
      message: "AI returned no usable suggestions.",
    };
  }

  const existing = await db
    .select({
      question_en: faqSuggestionTable.question_en,
      status: faqSuggestionTable.status,
    })
    .from(faqSuggestionTable)
    .where(
      or(
        eq(faqSuggestionTable.status, "pending"),
        eq(faqSuggestionTable.status, "accepted"),
      ),
    );
  const existingKeys = new Set(
    existing.map((e) => normalizeForDedup(e.question_en)),
  );

  const fresh = parsed.filter(
    (s) => !existingKeys.has(normalizeForDedup(s.question_en)),
  );

  if (fresh.length === 0) {
    return {
      ok: true,
      ticketsAnalyzed: tickets.length,
      suggestionsCreated: 0,
      message: "All candidates were duplicates of existing pending or accepted entries.",
    };
  }

  await db.insert(faqSuggestionTable).values(
    fresh.map((s) => ({
      question_en: s.question_en,
      answer_en: s.answer_en,
      question_es: s.question_es || null,
      answer_es: s.answer_es || null,
      status: "pending" as const,
      source_ticket_count: s.similar_count,
      source_ticket_ids: s.source_ticket_ids,
      raw_ai_response: rawContent,
    })),
  );

  return {
    ok: true,
    ticketsAnalyzed: tickets.length,
    suggestionsCreated: fresh.length,
    duplicatesSkipped: parsed.length - fresh.length,
  };
});
