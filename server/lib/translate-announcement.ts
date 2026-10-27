import { aiChat, getDefaultAiModel } from "./hackclub-ai";

// sentinels split one completion into two fields without the model's newlines confusing the parse
const TITLE_SENTINEL = "TITLE<<<a7f3c9e1>>>";
const CONTENT_SENTINEL = "CONTENT<<<a7f3c9e1>>>";

export type AnnouncementTranslation = {
  title_es: string;
  body_es: string;
};

// No caching: called once per broadcast and persisted. Falls back to English so a broadcast never blocks.
export async function translateAnnouncement(
  titleEn: string,
  bodyEn: string,
): Promise<AnnouncementTranslation> {
  const fallback: AnnouncementTranslation = {
    title_es: titleEn,
    body_es: bodyEn,
  };

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey;
  if (!aiKey) {
    console.warn(
      "[translate-announcement] No hackclubAiKey configured, returning English",
    );
    return fallback;
  }

  const systemPrompt = [
    "You are a translator. Translate the following broadcast announcement from English to Spanish.",
    "The announcement is shown to teenage makers. Keep the tone clear and friendly.",
    "Preserve all Markdown syntax exactly (headings, lists, bold, italics, code, links, image references).",
    "Do NOT translate URLs, file paths, or code inside backticks or code fences.",
    "Do NOT add commentary or explanation. Respond in exactly this format, with no extra whitespace outside the sections:",
    "",
    `${TITLE_SENTINEL}`,
    "<translated title>",
    `${CONTENT_SENTINEL}`,
    "<translated body>",
  ].join("\n");

  const userMessage = [
    TITLE_SENTINEL,
    titleEn,
    CONTENT_SENTINEL,
    bodyEn,
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
    console.error("[translate-announcement] AI call failed", err);
    return fallback;
  }
}

function parseTranslationResponse(
  raw: string,
): AnnouncementTranslation | null {
  const trimmed = raw.trim();
  const contentIdx = trimmed.indexOf(CONTENT_SENTINEL);
  if (contentIdx < 0) {
    console.warn("[translate-announcement] CONTENT sentinel missing in response");
    return null;
  }

  const head = trimmed.slice(0, contentIdx).trim();
  const body = trimmed.slice(contentIdx + CONTENT_SENTINEL.length).trim();

  const titleIdx = head.indexOf(TITLE_SENTINEL);
  if (titleIdx < 0) {
    console.warn("[translate-announcement] TITLE sentinel missing in response");
    return null;
  }

  const title = head.slice(titleIdx + TITLE_SENTINEL.length).trim();
  if (!title || !body) {
    console.warn("[translate-announcement] Translation returned empty title or body");
    return null;
  }

  return { title_es: title, body_es: body };
}
