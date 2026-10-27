import { cached } from "./cache";
import { aiChat, getDefaultAiModel } from "./hackclub-ai";

const TITLE_SENTINEL = "TITLE<<<a7f3c9e1>>>";
const CONTENT_SENTINEL = "CONTENT<<<a7f3c9e1>>>";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

export type JournalTranslation = {
  short_brief: string;
  long_brief: string;
};

export function journalTranslationKey(journalId: number, target: string): string {
  // must stay a template literal, or invalidatePattern silently matches nothing
  return `journal:translation:${journalId}:${target}`;
}

// on any AI/network/parse failure, returns the originals so readers still see the source text
export async function translateJournal(
  journalId: number,
  source: string,
  target: string,
  shortBrief: string,
  longBrief: string,
): Promise<JournalTranslation> {
  if (source === target) {
    return { short_brief: shortBrief, long_brief: longBrief };
  }

  return cached(
    journalTranslationKey(journalId, target),
    30 * 24 * 60 * 60, // fresh for 30 days
    () => runTranslation(source, target, shortBrief, longBrief),
    { staleSeconds: 30 * 24 * 60 * 60 }, // 30 more days as stale window
  );
}

async function runTranslation(
  source: string,
  target: string,
  shortBrief: string,
  longBrief: string,
): Promise<JournalTranslation> {
  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey;
  const fallback: JournalTranslation = { short_brief: shortBrief, long_brief: longBrief };

  if (!aiKey) {
    console.warn("[translate] No hackclubAiKey configured, returning originals");
    return fallback;
  }

  const systemPrompt = [
    `You are a translator. Translate the following journal entry from ${LANGUAGE_NAMES[source] || source} to ${LANGUAGE_NAMES[target] || target}.`,
    "Preserve all markdown syntax exactly (headings, lists, bold, italics, code, links, image references).",
    "Do NOT translate URLs, file paths, code inside backticks, or code fences.",
    "Do NOT add commentary or explanation. Respond in exactly this format, with no extra whitespace outside the sections:",
    "",
    `${TITLE_SENTINEL}`,
    "<translated title>",
    `${CONTENT_SENTINEL}`,
    "<translated body>",
  ].join("\n");

  const userMessage = [
    TITLE_SENTINEL,
    shortBrief,
    CONTENT_SENTINEL,
    longBrief,
  ].join("\n");

  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 4096,
      },
    });

    return parseTranslationResponse(res?.choices?.[0]?.message?.content ?? "") ?? fallback;
  } catch (err) {
    console.error("[translate] AI call failed", err);
    return fallback;
  }
}

function parseTranslationResponse(raw: string): JournalTranslation | null {
  const trimmed = raw.trim();
  const contentIdx = trimmed.indexOf(CONTENT_SENTINEL);
  if (contentIdx < 0) {
    console.warn("[translate] CONTENT sentinel missing in response");
    return null;
  }

  const head = trimmed.slice(0, contentIdx).trim();
  const body = trimmed.slice(contentIdx + CONTENT_SENTINEL.length).trim();

  const titleIdx = head.indexOf(TITLE_SENTINEL);
  if (titleIdx < 0) {
    console.warn("[translate] TITLE sentinel missing in response");
    return null;
  }

  const title = head.slice(titleIdx + TITLE_SENTINEL.length).trim();
  if (!title || !body) {
    console.warn("[translate] Translation returned empty title or body");
    return null;
  }

  return { short_brief: title, long_brief: body };
}
