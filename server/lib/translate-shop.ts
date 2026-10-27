import { cached, invalidatePattern } from "./cache";
import { aiChat, getDefaultAiModel } from "./hackclub-ai";

const NAME_SENTINEL = "NAME<<<b9d2e4f7>>>";
const DESC_SENTINEL = "DESC<<<b9d2e4f7>>>";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

export type ShopItemTranslation = {
  name: string;
  description: string;
};

export function shopItemTranslationKey(itemId: number | string, target: string): string {
  return `shop_item:translation:${itemId}:${target}`;
}

export async function invalidateShopItemTranslations(itemId: number | string): Promise<void> {
  await invalidatePattern(`shop_item:translation:${itemId}:*`);
}

// Admin overrides win over both the AI translation and the cache, so edits apply without a cache bust.
export async function translateShopItem(
  itemId: number | string,
  target: string,
  name: string,
  description: string | null,
  source = "en",
  overrides?: {
    name?: Record<string, string> | null;
    description?: Record<string, string> | null;
  },
): Promise<ShopItemTranslation> {
  const safeDescription = description ?? "";
  if (source === target || !target) {
    return { name, description: safeDescription };
  }

  const overrideName = overrides?.name?.[target]?.trim();
  const overrideDescription = overrides?.description?.[target]?.trim();
  if (overrideName && overrideDescription) {
    return { name: overrideName, description: overrideDescription };
  }

  const cachedResult = await cached(
    shopItemTranslationKey(itemId, target),
    30 * 24 * 60 * 60, // 30-day fresh translation ttl
    () => runTranslation(source, target, name, safeDescription),
    { staleSeconds: 30 * 24 * 60 * 60 }, // 30-day stale window
  );

  return {
    name: overrideName || cachedResult.name,
    description: overrideDescription || cachedResult.description,
  };
}

async function runTranslation(
  source: string,
  target: string,
  name: string,
  description: string,
): Promise<ShopItemTranslation> {
  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey;
  const fallback: ShopItemTranslation = { name, description };

  if (!aiKey) {
    console.warn("[translate-shop] No hackclubAiKey configured, returning originals");
    return fallback;
  }

  const systemPrompt = [
    `You are a translator for an e-commerce reward shop aimed at teenagers. Translate the following shop item from ${LANGUAGE_NAMES[source] || source} to ${LANGUAGE_NAMES[target] || target}.`,
    "Keep the tone casual and engaging. Keep product/brand names (e.g. MacBook, Arduino, Flipper Zero, Raspberry Pi) in their original form.",
    "Do NOT add commentary or explanation. Respond in exactly this format:",
    "",
    `${NAME_SENTINEL}`,
    "<translated name>",
    `${DESC_SENTINEL}`,
    "<translated description>",
  ].join("\n");

  const userMessage = [
    NAME_SENTINEL,
    name,
    DESC_SENTINEL,
    description,
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
        max_tokens: 1024,
      },
    });

    return parseTranslationResponse(res?.choices?.[0]?.message?.content ?? "") ?? fallback;
  } catch (err) {
    console.error("[translate-shop] AI call failed", err);
    return fallback;
  }
}

function parseTranslationResponse(raw: string): ShopItemTranslation | null {
  const trimmed = raw.trim();
  const descIdx = trimmed.indexOf(DESC_SENTINEL);
  if (descIdx < 0) {
    console.warn("[translate-shop] DESC sentinel missing in response");
    return null;
  }

  const head = trimmed.slice(0, descIdx).trim();
  const body = trimmed.slice(descIdx + DESC_SENTINEL.length).trim();

  const nameIdx = head.indexOf(NAME_SENTINEL);
  if (nameIdx < 0) {
    console.warn("[translate-shop] NAME sentinel missing in response");
    return null;
  }

  const translatedName = head.slice(nameIdx + NAME_SENTINEL.length).trim();
  if (!translatedName) {
    console.warn("[translate-shop] Translation returned empty name");
    return null;
  }

  return { name: translatedName, description: body };
}
