import { aiChat, getDefaultAiModel } from "./hackclub-ai";

const SYSTEM_PROMPT = [
  "You are a language detector and translator.",
  "If the following text is already in English, return it EXACTLY as-is — do not rephrase, improve, or alter it in any way.",
  "If the text is not in English, translate it to English.",
  "Output ONLY the text itself with no preamble, explanation, or commentary.",
].join("\n");

export async function translateDescriptionToEnglish(text: string): Promise<string> {
  if (!text.trim()) return text;

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) {
    console.warn("[translate-description] No hackclubAiKey configured, skipping translation");
    return text;
  }

  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        max_tokens: 2048,
      },
    });

    const translated = res?.choices?.[0]?.message?.content?.trim() ?? "";
    return translated || text;
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { statusCode?: number; status?: number })?.status;
    console.error(
      "[translate-description] AI call failed, using original:",
      status ? `${status}` : "",
      (err as { message?: string })?.message ?? "unknown error",
    );
    return text;
  }
}
