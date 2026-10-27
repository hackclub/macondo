import { createHash } from "node:crypto";
import { cached } from "./cache";
import { aiChat } from "./hackclub-ai";

export const KAI_DEVBOARD_URL =
  "https://raw.githubusercontent.com/KaiPereira/portfolio/main/src/lib/posts/build-a-devboard.md";
export const KAI_DEVBOARD_CANONICAL =
  "https://kaipereira.com/journal/build-a-devboard";
export const KAI_ASSET_BASE = "https://kaipereira.com";
export const KAI_AUTHOR_NAME = "Kai Pereira";
export const KAI_AUTHOR_URL = "https://kaipereira.com";

export const FLIGHT_CONTROLLER_URL =
  "https://raw.githubusercontent.com/notaroomba/simpleflightcontroller/main/GUIDE.md";
export const FLIGHT_CONTROLLER_CANONICAL =
  "https://github.com/notaroomba/simpleflightcontroller/blob/main/GUIDE.md";
export const FLIGHT_CONTROLLER_ASSET_BASE =
  "https://raw.githubusercontent.com/notaroomba/simpleflightcontroller/main";
export const FLIGHT_CONTROLLER_AUTHOR_NAME = "NotARoomba";
export const FLIGHT_CONTROLLER_AUTHOR_URL = "https://notaroomba.dev";

const SOURCE_FRESH_SECONDS = 15 * 60;
const SOURCE_STALE_SECONDS = 60 * 60;

const CONTENT_SENTINEL = "CONTENT<<<a7f3c9e1>>>";

// Bump when the translation prompt changes so cached translations regenerate.
const PROMPT_VERSION = "v3";

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

export interface FetchedGuide {
  markdown: string;
  sourceHash: string;
}

interface GuideTranslationContext {
  cacheKeyBase: string;
  authorName: string;
  glossary: readonly string[];
}

export async function fetchKaiDevboardSource(): Promise<FetchedGuide> {
  return cached(
    "external-guide:source:build-a-devboard",
    SOURCE_FRESH_SECONDS,
    async () => {
      const raw = await $fetch<string>(KAI_DEVBOARD_URL, {
        responseType: "text",
        timeout: 10000,
      });
      const processed = processGuideMarkdown(raw);
      return {
        markdown: processed,
        sourceHash: createHash("sha256").update(processed).digest("hex").slice(0, 12),
      };
    },
    { staleSeconds: SOURCE_STALE_SECONDS },
  );
}

export async function fetchFlightControllerSource(): Promise<FetchedGuide> {
  return cached(
    "external-guide:source:flight-controller",
    SOURCE_FRESH_SECONDS,
    async () => {
      const raw = await $fetch<string>(FLIGHT_CONTROLLER_URL, {
        responseType: "text",
        timeout: 10000,
      });
      const processed = stripAuthorCreditLine(
        processRepoGuideMarkdown(raw, FLIGHT_CONTROLLER_ASSET_BASE),
        FLIGHT_CONTROLLER_AUTHOR_NAME,
      );
      return {
        markdown: processed,
        sourceHash: createHash("sha256").update(processed).digest("hex").slice(0, 12),
      };
    },
    { staleSeconds: SOURCE_STALE_SECONDS },
  );
}

export function processGuideMarkdown(raw: string): string {
  const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return rewriteRelativeUrls(stripped, KAI_ASSET_BASE);
}

export function processRepoGuideMarkdown(raw: string, base: string): string {
  const stripped = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  return rewriteRepoRelativeUrls(stripped, base);
}

// Avoids doubling up with the locale-aware credit the guide component injects after the </h1>.
export function stripAuthorCreditLine(
  markdown: string,
  handle: string,
): string {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(
    new RegExp(
      `^[ \\t]*made by[ \\t]+\\[?@?${escaped}\\b\\]?(?:\\([^)]+\\))?[ \\t]*\\r?\\n?`,
      "gim",
    ),
    "",
  );
}

function rewriteRelativeUrls(markdown: string, base: string): string {
  let out = markdown.replace(
    /(!\[[^\]]*\])\((\/[^)\s]+)\)/g,
    (_, label: string, path: string) => `${label}(${base}${path})`,
  );
  out = out.replace(
    /(?<!!)(\[[^\]]+\])\((\/[^)\s]+)\)/g,
    (_, label: string, path: string) => `${label}(${base}${path})`,
  );
  return out;
}

function rewriteRepoRelativeUrls(markdown: string, base: string): string {
  const cleanBase = base.replace(/\/+$/, "");
  const resolve = (path: string): string => {
    if (/^https?:\/\//i.test(path)) return path;
    if (/^mailto:/i.test(path)) return path;
    if (path.startsWith("#")) return path;
    const stripped = path.startsWith("./") ? path.slice(2) : path;
    if (stripped.startsWith("/")) return `${cleanBase}${stripped}`;
    return `${cleanBase}/${stripped}`;
  };
  let out = markdown.replace(
    /(!\[[^\]]*\])\(([^)\s]+)\)/g,
    (_, label: string, path: string) => `${label}(${resolve(path)})`,
  );
  out = out.replace(
    /(?<!!)(\[[^\]]+\])\(([^)\s]+)\)/g,
    (_, label: string, path: string) => `${label}(${resolve(path)})`,
  );
  return out;
}

export async function translateKaiDevboard(
  sourceMarkdown: string,
  sourceHash: string,
  target: string,
): Promise<string> {
  return translateGuide(sourceMarkdown, sourceHash, target, {
    cacheKeyBase: "build-a-devboard",
    authorName: "Kai Pereira",
    glossary: [
      "PCB",
      "USB",
      "USB-C",
      "RP2040",
      "SoC",
      "GPIO",
      "I/O",
      "ADC",
      "VDD",
      "GND",
      "SRAM",
      "KiCad",
      "EasyEDA",
      "JLCPCB",
      "LCSC",
    ],
  });
}

export async function translateFlightController(
  sourceMarkdown: string,
  sourceHash: string,
  target: string,
): Promise<string> {
  return translateGuide(sourceMarkdown, sourceHash, target, {
    cacheKeyBase: "flight-controller",
    authorName: "NotARoomba",
    glossary: [
      "PCB",
      "USB",
      "USB-C",
      "MCU",
      "STM32",
      "STM32CubeMX",
      "IMU",
      "ESC",
      "BEC",
      "LiPo",
      "PWM",
      "I2C",
      "SPI",
      "UART",
      "DMA",
      "ADC",
      "DAC",
      "GPIO",
      "FPU",
      "RTOS",
      "GND",
      "VDD",
      "VBUS",
      "KiCad",
      "JLCPCB",
      "EasyEDA",
      "LCSC",
      "BOM",
      "SMT",
      "JTAG",
      "SWD",
      "OLED",
      "LED",
      "RTC",
    ],
  });
}

async function translateGuide(
  sourceMarkdown: string,
  sourceHash: string,
  target: string,
  ctx: GuideTranslationContext,
): Promise<string> {
  if (target === "en") return sourceMarkdown;
  return cached(
    `external-guide:translation:${ctx.cacheKeyBase}:${target}:${sourceHash}:${PROMPT_VERSION}`,
    30 * 24 * 60 * 60, // translations stay fresh for 30 days
    () => translateMarkdownInChunks(sourceMarkdown, "en", target, ctx),
    { staleSeconds: 30 * 24 * 60 * 60 }, // then serve stale for 30 more days
  );
}

async function translateMarkdownInChunks(
  source: string,
  sourceLang: string,
  targetLang: string,
  ctx: GuideTranslationContext,
): Promise<string> {
  const translated: string[] = [];
  for (const chunk of splitByH2(source)) {
    translated.push(await translateChunk(chunk, sourceLang, targetLang, ctx));
  }
  // parseChunkResponse trims each chunk, so the blank line keeps every "## " heading on its own line.
  return translated.join("\n\n");
}

function splitByH2(markdown: string): string[] {
  // Keep delimiters: every chunk after the first starts with "## ".
  const parts = markdown.split(/(?=^## )/m);
  return parts.length === 0 ? [markdown] : parts;
}

async function translateChunk(
  chunk: string,
  sourceLang: string,
  targetLang: string,
  ctx: GuideTranslationContext,
): Promise<string> {
  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey;
  if (!aiKey) {
    console.warn("[external-guides] No hackclubAiKey configured, returning chunk as-is");
    return chunk;
  }

  const systemPrompt = [
    `You are a translator. Translate the following markdown chunk from ${LANGUAGE_NAMES[sourceLang] || sourceLang} to ${LANGUAGE_NAMES[targetLang] || targetLang}.`,
    "Preserve all markdown syntax exactly (headings, lists, bold, italics, links, image references, code spans, code fences).",
    "",
    "Backtick handling, IMPORTANT:",
    "- Inline backticks often wrap menu instructions, UI labels, or button text in this guide. When the backtick content is human-readable prose (sentences, instructions, UI navigation like 'File -> New Project'), TRANSLATE the prose and KEEP the backticks around the result.",
    "- Only leave backtick content untranslated when it is actual programming syntax: function or method calls (e.g. `useEffect()`), identifiers (e.g. `myVariable`), file paths (e.g. `src/main.c`), file names with extensions (e.g. `config.json`), shell commands (e.g. `npm install`), or HTML/XML tags.",
    "- Inside fenced code blocks (``` ... ```), translate ONLY comments. Leave all other code untouched.",
    "",
    "Other rules:",
    "- Do NOT translate URLs.",
    `- Do NOT translate the author name '${ctx.authorName}'.`,
    `- Keep technical acronyms (${ctx.glossary.join(", ")}, etc.) untranslated.`,
    "- Do NOT add commentary or explanation. Respond in exactly this format, with no extra whitespace outside the section:",
    "",
    `${CONTENT_SENTINEL}`,
    "<translated markdown>",
  ].join("\n");

  const userMessage = [CONTENT_SENTINEL, chunk].join("\n");

  try {
    const raw =
      (
        await aiChat<{ choices: { message: { content: string } }[] }>({
          apiKey: aiKey,
          model: getDefaultAiModel(),
          timeout: 60000,
          body: {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            max_tokens: 8192,
          },
        })
      )?.choices?.[0]?.message?.content ?? "";
    return parseChunkResponse(raw) ?? chunk;
  } catch (err) {
    console.error("[external-guides] AI translation chunk failed", err);
    return chunk;
  }
}

function parseChunkResponse(raw: string): string | null {
  const trimmed = raw.trim();
  const idx = trimmed.indexOf(CONTENT_SENTINEL);
  if (idx < 0) {
    console.warn("[external-guides] CONTENT sentinel missing in response");
    return null;
  }
  const body = trimmed.slice(idx + CONTENT_SENTINEL.length).trim();
  if (!body) {
    console.warn("[external-guides] Translation returned empty body");
    return null;
  }
  return body;
}
