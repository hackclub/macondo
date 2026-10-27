import { cached } from "./cache";
import { aiChat, getDefaultAiModel } from "./hackclub-ai";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

export function shipFeedbackTranslationKey(shipId: number, target: string): string {
  return `ship:feedback_translation:${shipId}:${target}`;
}

// Display-only: never write the result back into decision_user_message, the English source of truth.
export async function translateShipFeedback(
  shipId: number,
  target: string,
  sourceText: string,
  source = "en",
): Promise<string> {
  if (!sourceText) return sourceText;
  if (source === target || !target) return sourceText;

  return cached(
    shipFeedbackTranslationKey(shipId, target),
    30 * 24 * 60 * 60, // 30-day fresh translation ttl
    () => runTranslation(source, target, sourceText),
    { staleSeconds: 30 * 24 * 60 * 60 }, // 30-day stale window
  );
}

async function runTranslation(
  source: string,
  target: string,
  text: string,
): Promise<string> {
  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey;
  if (!aiKey) {
    console.warn("[translate-feedback] No hackclubAiKey configured, returning original");
    return text;
  }

  const systemPrompt = [
    `You are a translator for reviewer feedback sent to a teenage maker. Translate the following review note from ${LANGUAGE_NAMES[source] || source} to ${LANGUAGE_NAMES[target] || target}.`,
    "Keep the tone constructive and concrete. Preserve any URLs, file paths, and code/command names exactly.",
    "Preserve line breaks and markdown formatting.",
    "Output ONLY the translated text, with no preamble, quotes, or commentary.",
  ].join("\n");

  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
        max_tokens: 2048,
      },
    });

    const raw = res?.choices?.[0]?.message?.content?.trim() ?? "";
    return raw || text;
  } catch (err) {
    console.error("[translate-feedback] AI call failed", err);
    return text;
  }
}
