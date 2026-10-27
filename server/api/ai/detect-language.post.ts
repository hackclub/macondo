import { macondoHasEnded } from "../../lib/macondo-end";
import { getSession } from "~~/server/lib/session";
import { aiChat, getDefaultAiModel } from "~~/server/lib/hackclub-ai";

type DetectResult = { language: "en" | "es" };

// Asks for a single word so the reply parses trivially and stays cheap.
const SYSTEM_PROMPT = `You classify the language of a journal entry written by a teenager.
Respond with exactly one word, lowercase, no punctuation: either "english" or "spanish".
If the text is empty, mixed, or ambiguous, pick the language that more of the content uses.
Do not explain. Do not translate. Output only the single word.`;

export default defineEventHandler(async (event) => {
  if (macondoHasEnded()) {
    throw createError({ statusCode: 410, statusMessage: "AI assistance is closed because the event has ended" });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const body = (await readBody<{ text?: string }>(event)) ?? {};
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text || text.length < 20) { // too short to classify reliably
    return { language: "en" } satisfies DetectResult;
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) {
    console.warn("[ai/detect-language] No HACKCLUB_AI_KEY configured");
    return { language: "en" } satisfies DetectResult;
  }

  const truncated = text.slice(0, 2000);

  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: truncated },
        ],
        max_tokens: 4, // only a language code comes back
        temperature: 0,
      },
    });

    const raw = (res.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
    if (raw.startsWith("spanish") || raw.startsWith("es")) {
      return { language: "es" } satisfies DetectResult;
    }
    return { language: "en" } satisfies DetectResult;
  } catch (err) {
    const status = (err as { statusCode?: number; status?: number })?.statusCode
      ?? (err as { statusCode?: number; status?: number })?.status;
    console.error(
      "[ai/detect-language] AI call failed:",
      status ? `${status}` : "",
      (err as { message?: string })?.message ?? "unknown error",
    );
    return { language: "en" } satisfies DetectResult;
  }
});
