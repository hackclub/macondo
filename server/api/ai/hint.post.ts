import { macondoHasEnded } from "../../lib/macondo-end";
import { getSession } from "~~/server/lib/session";
import { guardAiRequest } from "~~/server/lib/ai-guard";
import { cached } from "~~/server/lib/cache";
import { aiChat, getDefaultAiModel } from "~~/server/lib/hackclub-ai";

const SUBSTEP_CONTEXT: Record<string, string> = {
  html_structure: "creating the basic HTML structure (DOCTYPE, html, head, body tags)",
  add_content: "adding a heading with their name and a paragraph with their description inside the body",
  add_image: "adding an image tag with a src URL",
  add_css: "linking a CSS stylesheet in the head and writing their first CSS rules",
  style_page: "styling their page with text-align, font-family, background color, and text color",
  explore_css: "freely experimenting with HTML and CSS to personalize their website",
  readme: "writing a README.md file in Markdown for their project repository",
};

const EXPLORE_STEPS = new Set(["explore_css"]);

export default defineEventHandler(async (event) => {
  if (macondoHasEnded()) {
    throw createError({ statusCode: 410, statusMessage: "AI assistance is closed because the event has ended" });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string;

  const { html, css, currentStep, error, locale } = (await readBody(event)) as {
    html?: string;
    css?: string;
    currentStep?: string;
    error?: string;
    locale?: string;
  };

  const guard = await guardAiRequest({
    userId: user.id,
    bucket: "hint",
    payload: `${html || ""}${css || ""}`,
    limit: 20,
    windowSeconds: 60,
  });
  if (!guard.ok) {
    throw createError({ statusCode: guard.status, statusMessage: guard.message });
  }

  const stepContext = SUBSTEP_CONTEXT[currentStep ?? ""] || "building their personal website";
  const isExplore = EXPLORE_STEPS.has(currentStep ?? "");

  // Unknown locales fall back to English.
  const LANGUAGE_NAME: Record<string, string> = {
    en: "English",
    es: "Spanish",
  };
  const responseLanguage = LANGUAGE_NAME[(locale || "").toLowerCase()] ?? "English";
  const languageRule = `- Respond in ${responseLanguage}. Never mix languages; the student only reads ${responseLanguage}.`;

  // Fallbacks for a missing key or failed call, so the Spanish UI never shows English.
  const FALLBACK_GENERIC: Record<string, string> = {
    en: "Try checking that all your tags are properly opened and closed, and that they are in the right order.",
    es: "Revisa que todas tus etiquetas estén correctamente abiertas y cerradas, y que estén en el orden correcto.",
  };
  const FALLBACK_TAGS: Record<string, string> = {
    en: "Try double-checking that all your tags are properly closed.",
    es: "Vuelve a revisar que todas tus etiquetas estén correctamente cerradas.",
  };
  const localeKey = (locale || "").toLowerCase() in FALLBACK_GENERIC ? (locale || "").toLowerCase() : "en";
  const fallbackGeneric = FALLBACK_GENERIC[localeKey]!;
  const fallbackTags = FALLBACK_TAGS[localeKey]!;

  if (!aiKey) {
    console.warn("[ai/hint] No HACKCLUB_AI_KEY configured");
    return { hint: fallbackGeneric };
  }

  const systemPrompt = isExplore
    ? `You are a friendly coding tutor. A student is building their first HTML/CSS website. They are freely experimenting with their code to make the page their own. There is NO example layout or design they need to match. This is a free exploration step where they can do whatever they want.

CRITICAL RULES:
${languageRule}
- NEVER include code blocks, code snippets, or HTML/CSS tags in your response. Not even as examples. Explain in plain ${responseLanguage} only.
- No emojis. No em dashes. Use simple punctuation only.
- Keep your response to 2-3 sentences maximum.
- NEVER say their page "doesn't match" anything or that their code is "wrong" unless there is an actual syntax error. There is no correct layout here.
- Your job is ONLY to help with actual errors: syntax errors, unclosed tags, missing semicolons, typos in property names, or anything that would prevent their code from working correctly.
- If their code has no syntax errors, suggest something fun they could try. For example, suggest a CSS property they haven't used yet or an HTML element they could add.
- Reference specific line numbers when pointing out actual errors.
- Be encouraging and supportive. This is their creative playground.`
    : `You are a friendly coding tutor. A student is building their first HTML/CSS website. They are currently ${stepContext}. Treat them as brand new to coding.

CRITICAL RULES:
${languageRule}
- NEVER include code blocks, code snippets, or HTML/CSS tags in your response. Not even as examples. Explain in plain ${responseLanguage} only.
- No emojis. No em dashes. Use simple punctuation only.
- Keep your response to 1-2 sentences maximum.
- ONLY address the current step. Do NOT mention future steps or anything beyond what they are working on right now.
- NEVER tell the student to "re-read the instructions" or "look at the instructions above". Instead, directly explain what they need to do in plain words.
- AVOID JARGON. Never say "CSS class", "class attribute", "attribute", "selector", "declaration", or "property". Instead say things like "the piece inside the tag", "the part after the equals sign", "the style label", or "the style word". (Translate these phrases naturally into ${responseLanguage} while keeping the same meaning.)
- For Tailwind class names like text-blue-500 or bg-pink-100, call them "style words" or "style labels", not "CSS classes".
- If their code has an error (like a mismatched tag), describe the error in plain ${responseLanguage}. For example say "your closing tag on line 3 does not match the opening tag" instead of showing them the corrected code. Reference specific line numbers when possible.
- NEVER write out full HTML structures or CSS rules. Just describe what they need to do in words.
- On the first hint: explain the next thing they should try. Be specific about what to add and where.
- On later hints (when previous hints are listed): be more specific about what is wrong or missing. After 3+ hints you can mention specific tag names like "add a body tag after the closing head tag".`;

  const userMessage = `Here is my current code:\n\nindex.html:\n${html || "(empty)"}\n\nstyle.css:\n${css || "(empty)"}\n\n${error ? `I'm getting this error: ${error}` : "I'm stuck and not sure what to do next."}`;

  // First hints share a cached pool of generic openers per step+locale;
  // follow-ups bypass it because they depend on the hint chain and live code.
  if ((!error || !error.includes("I have already received these hints")) && !isExplore && currentStep) {
    try {
      const pool = await cached(
        `hint-pool:v1:${currentStep}:${localeKey}`,
        7 * 86400, // cache the hint pool for a week
        async () => {
          const genericUser = "I'm stuck and not sure what to do next. Give me a first hint about what to try.";
          const calls = Array.from({ length: 5 }, () =>
            aiChat<{ choices: { message: { content: string } }[] }>({
              apiKey: aiKey,
              model: getDefaultAiModel(),
              body: {
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: genericUser },
                ],
                max_tokens: 300,
                temperature: 1.0,
              },
            })
              .then((res) => {
                const choice = res.choices?.[0]?.message as Record<string, unknown> | undefined;
                return (choice?.content as string | null)?.trim() || "";
              })
              .catch(() => ""),
          );
          return (await Promise.all(calls)).filter((h) => h.length > 0);
        },
        { staleSeconds: 30 * 86400 }, // 30 days
      );
      if (pool.length > 0) {
        return { hint: pool[Math.floor(Math.random() * pool.length)]! };
      }
    } catch (err) {
      console.warn("[ai/hint] pool lookup failed, falling through to live AI", err);
    }
  }

  console.log("[ai/hint] Request:", { step: currentStep, htmlLen: html?.length, cssLen: css?.length });

  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 300,
      },
    });

    console.log("[ai/hint] Response:", JSON.stringify(res).slice(0, 500));

    const choice = res.choices?.[0]?.message as Record<string, unknown> | undefined;
    const hint = (choice?.content as string | null)?.trim() || "";

    if (!hint && choice?.reasoning) {
      console.warn("[ai/hint] content was null, model used reasoning tokens only");
    }

    if (!hint) {
      console.warn("[ai/hint] Empty hint from AI, full response:", JSON.stringify(res).slice(0, 800));
    }
    return { hint: hint || fallbackGeneric };
  } catch (err: unknown) {
    const e = err as { data?: unknown; statusCode?: number; message?: string };
    console.error("[ai/hint] Error:", {
      statusCode: e.statusCode,
      message: e.message,
      data: JSON.stringify(e.data).slice(0, 500),
    });
    return { hint: fallbackTags };
  }
});
