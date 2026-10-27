import { eq } from "drizzle-orm";

import db from "../../../../db";
import { kbSuggestionTable } from "../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { aiChat, getDefaultAiModel } from "../../../../lib/hackclub-ai";
import { canManageSupporterKB } from "../../../../policies/internal";

const SYSTEM_PROMPT =
  `You translate knowledge base entries from English to Spanish for Macondo, a youth coding program (ages 13 to 18). ` +
  `Output strict JSON: {"question_es":"...","answer_es":"..."}. ` +
  `Keep the tone warm, direct, and natural for a teen audience. Preserve meaning precisely. ` +
  `Do not use em dashes or double hyphens; use commas or periods instead. ` +
  `Respond with ONLY the JSON object, no markdown fencing, no prose.`;

function stripDashes(s: string): string {
  return s.replace(/\u2014/g, ", ").replace(/-{2}/g, ", ");
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canManageSupporterKB(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isInteger(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [suggestion] = await db
    .select()
    .from(kbSuggestionTable)
    .where(eq(kbSuggestionTable.id, id));
  if (!suggestion) {
    throw createError({ statusCode: 404, statusMessage: "Not found" });
  }
  if (suggestion.status !== "pending") {
    throw createError({
      statusCode: 409,
      statusMessage: "Only pending suggestions can be retranslated",
    });
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: "AI service not configured",
    });
  }

  const userMessage =
    `Translate this knowledge base entry into Spanish:\n` +
    `Question (EN): ${suggestion.question_en}\n` +
    `Answer (EN): ${suggestion.answer_en}\n\n` +
    `Return JSON only.`;

  let rawContent = "";
  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 800,
        temperature: 0.2,
      },
    });
    rawContent = (res.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("[kb-suggestions/retranslate] AI call failed", err);
    throw createError({ statusCode: 502, statusMessage: "AI request failed" });
  }

  const jsonText = (() => {
    const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1]!.trim();
    const start = rawContent.indexOf("{");
    const end = rawContent.lastIndexOf("}");
    if (start >= 0 && end > start) return rawContent.slice(start, end + 1);
    return rawContent;
  })();

  let questionEs = "";
  let answerEs = "";
  try {
    const obj = JSON.parse(jsonText) as {
      question_es?: unknown;
      answer_es?: unknown;
    };
    if (typeof obj.question_es === "string") {
      questionEs = obj.question_es.trim();
    }
    if (typeof obj.answer_es === "string") answerEs = obj.answer_es.trim();
  } catch (err) {
    console.warn("[kb-suggestions/retranslate] JSON parse failed", err);
  }

  if (!questionEs || !answerEs) {
    throw createError({
      statusCode: 502,
      statusMessage: "AI returned unusable translation",
    });
  }

  const [updated] = await db
    .update(kbSuggestionTable)
    .set({
      question_es: stripDashes(questionEs),
      answer_es: stripDashes(answerEs),
      updated_at: new Date(),
    })
    .where(eq(kbSuggestionTable.id, id))
    .returning();

  await writeAudit({
    actor_id: actor.id,
    action: "kb_suggestion.retranslated",
    entity_type: "kb_suggestion",
    entity_id: String(id),
    old_value: {
      question_es: suggestion.question_es,
      answer_es: suggestion.answer_es,
    },
    new_value: {
      question_es: stripDashes(questionEs),
      answer_es: stripDashes(answerEs),
    },
  });

  return { ok: true, suggestion: updated };
});
