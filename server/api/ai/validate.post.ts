import { macondoHasEnded } from "../../lib/macondo-end";
import { getSession } from "~~/server/lib/session";
import { checkAddTailwind, checkStyleWithTailwind } from "~~/server/lib/tailwind-check";
import { guardAiRequest } from "~~/server/lib/ai-guard";
import { aiChat, getDefaultAiModel } from "~~/server/lib/hackclub-ai";

// Sent to the AI so it judges the step's intent, forgiving valid alternatives.
const STEP_GOALS: Record<string, string> = {
  html_structure:
    "The student should have a complete HTML skeleton: <!DOCTYPE html>, <html>, <head>, <body>, and at least one visible element (heading or paragraph) inside the body with their own text.",
  add_content:
    "The student should have at least one <h1> and one <p> inside <body>, both with their own text.",
  add_image:
    "The student should have an <img> tag with a real src URL and an alt attribute, inside the body.",
  add_tailwind:
    "The student should have a <script src=\"https://cdn.tailwindcss.com\"></script> tag inside <head>, and at least one HTML element with a Tailwind utility class like text-blue-500. They are using Tailwind classes as a wrapper around raw CSS.",
  style_with_tailwind:
    "The student should have Tailwind utility classes on at least two different elements, combining color (text-* or bg-*), size/spacing (text-*, p-*, or m-*), and one other class of their choice. No raw <style> attributes or <style> blocks.",
  readme:
    "The student should have a short Markdown README that starts with a # heading line and has at least a sentence of description below it.",
};

type SyntaxError = { file: "html" | "css"; line: number; message: string };

// Deliberately permissive: catches common breakage (unclosed tags, braces) with an approximate line.
function findSyntaxErrors(html: string, css: string): SyntaxError[] {
  const errors: SyntaxError[] = [];

  const voidTags = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr", "!doctype",
  ]);
  const tagStack: { name: string; line: number }[] = [];
  const tagRe = /<\/?([a-zA-Z!][a-zA-Z0-9]*)\b[^>]*?>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagRe.exec(html)) !== null) {
    const raw = tagMatch[0];
    const name = (tagMatch[1] || "").toLowerCase();
    const line = html.slice(0, tagMatch.index).split("\n").length - 1;
    const isSelfClose = raw.endsWith("/>");
    if (voidTags.has(name) || isSelfClose) continue;
    if (raw.startsWith("</")) {
      const top = tagStack.pop();
      if (!top || top.name !== name) {
        errors.push({
          file: "html",
          line,
          message: `Closing </${name}> does not match the most recent opening tag.`,
        });
      }
    } else {
      tagStack.push({ name, line });
    }
  }
  for (const leftover of tagStack) {
    errors.push({
      file: "html",
      line: leftover.line,
      message: `<${leftover.name}> is opened but never closed.`,
    });
  }

  if ((html.match(/</g) || []).length > (html.match(/>/g) || []).length) {
    errors.push({
      file: "html",
      line: 0,
      message: "There is an unclosed tag; every < needs a matching >.",
    });
  }

  if ((css.match(/\{/g) || []).length !== (css.match(/\}/g) || []).length) {
    const cssLines = css.split("\n");
    let firstOpenLine = 0;
    for (let i = 0; i < cssLines.length; i++) {
      if (cssLines[i]!.includes("{")) { firstOpenLine = i; break; }
    }
    errors.push({
      file: "css",
      line: firstOpenLine,
      message: "CSS braces are unbalanced; every { needs a matching }.",
    });
  }

  return errors;
}

type ValidationResponse = {
  passed: boolean;
  feedback: string;
};

export default defineEventHandler(async (event): Promise<ValidationResponse> => {
  if (macondoHasEnded()) {
    throw createError({ statusCode: 410, statusMessage: "AI assistance is closed because the event has ended" });
  }

  const user = await getSession(event);
  if (!user) {
    throw createError({ statusCode: 401, statusMessage: "Not authenticated" });
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string;

  const body = await readBody<{
    html?: string;
    css?: string;
    readme?: string;
    stepId?: string;
    locale?: string;
  }>(event);
  const html = body.html ?? "";
  const css = body.css ?? "";
  const readme = body.readme ?? "";
  const stepId = body.stepId ?? "";

  const guard = await guardAiRequest({
    userId: user.id,
    bucket: "validate",
    payload: `${html}${css}${readme}`,
    limit: 20,
    windowSeconds: 60,
  });
  if (!guard.ok) {
    throw createError({ statusCode: guard.status, statusMessage: guard.message });
  }

  // Pin AI and fallback feedback to the UI locale.
  const LANGUAGE_NAME: Record<string, string> = {
    en: "English",
    es: "Spanish",
  };
  const localeKey = body.locale && body.locale.toLowerCase() in LANGUAGE_NAME
    ? body.locale.toLowerCase()
    : "en";
  const responseLanguage = LANGUAGE_NAME[localeKey]!;

  // Kept here, not in the i18n files, because they're rendered server-side.
  const COPY: Record<string, {
    readmeHeading: string;
    readmeBody: string;
    syntax: (msg: string, file: string, line: number) => string;
    aiPassedWithSyntax: (msg: string, file: string, line: number) => string;
    aiFailedFallback: string;
  }> = {
    en: {
      readmeHeading: "Start your README with a # heading on the first line, like \"# My Site\".",
      readmeBody: "Add a sentence or two below the heading describing your site.",
      syntax: (msg, file, line) => `${msg} (${file} line ${line + 1})`,
      aiPassedWithSyntax: (msg, file, line) =>
        `Almost! The content looks right, but ${msg.toLowerCase()} Fix it on ${file} line ${line + 1} and try again.`,
      aiFailedFallback: "Take another look at the step and try again.",
    },
    es: {
      readmeHeading: "Empieza tu README con un título con # en la primera línea, por ejemplo \"# Mi sitio\".",
      readmeBody: "Añade una o dos oraciones debajo del título describiendo tu sitio.",
      syntax: (msg, file, line) => `${msg} (${file} línea ${line + 1})`,
      aiPassedWithSyntax: (msg, file, line) =>
        `¡Casi! El contenido se ve bien, pero ${msg.toLowerCase()} Arréglalo en ${file} línea ${line + 1} e intenta de nuevo.`,
      aiFailedFallback: "Revisa el paso otra vez e inténtalo de nuevo.",
    },
  };
  const copy = COPY[localeKey]!;

  const goal = STEP_GOALS[stepId];
  if (!goal) {
    return { passed: true, feedback: "" };
  }

  if (stepId === "readme") {
    const bodyWords = readme
      .replace(/^#+\s+.*$/gm, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!readme.split("\n").some((l) => /^#+\s+\S/.test(l.trim()))) {
      return { passed: false, feedback: copy.readmeHeading };
    }
    if (bodyWords.length < 4) { // minimum words in the readme body
      return { passed: false, feedback: copy.readmeBody };
    }
    return { passed: true, feedback: "" };
  }

  const syntaxErrors = findSyntaxErrors(html, css);

  if (stepId === "add_tailwind" || stepId === "style_with_tailwind") {
    const twLocale = localeKey === "es" ? "es" : "en";
    const check = stepId === "add_tailwind"
      ? checkAddTailwind(html, twLocale)
      : checkStyleWithTailwind(html, twLocale);
    if (!check.passed) {
      return { passed: false, feedback: check.feedback };
    }
    if (syntaxErrors.length > 0) {
      const first = syntaxErrors[0]!;
      return {
        passed: false,
        feedback: copy.aiPassedWithSyntax(first.message, first.file, first.line),
      };
    }
    return { passed: true, feedback: "" };
  }

  let aiPassed: boolean | null = null;
  let aiFeedback = "";

  if (aiKey) {
    try {
      const syntaxSummary = syntaxErrors.length
        ? `Detected local syntax issues: ${syntaxErrors.map((e) => `${e.file} line ${e.line + 1}: ${e.message}`).join("; ")}`
        : "No local syntax issues detected.";

      const res = await aiChat<{ choices: { message: { content: string } }[] }>({
        apiKey: aiKey,
        model: getDefaultAiModel(),
        body: {
          messages: [
            {
              role: "system",
              content: `You are validating a student's code for a tutorial step. Step goal: ${goal}\n\n${syntaxSummary}\n\nThe "feedback" value you return will be shown directly to the student, who only reads ${responseLanguage}. Write the feedback in ${responseLanguage}. The "passed" key is the literal JSON boolean, not translated.\n\nRespond with ONLY a JSON object: {"passed": true|false, "feedback": "short explanation in plain ${responseLanguage} if not passed, empty string if passed"}. No markdown, no code blocks, just the JSON. Keep feedback under 25 words.`,
            },
            {
              role: "user",
              content: `index.html:\n${html || "(empty)"}\n\nstyle.css:\n${css || "(empty)"}`,
            },
          ],
          max_tokens: 200,
        },
      });
      const content = res.choices?.[0]?.message?.content?.trim() || "";
      try {
        const parsed = JSON.parse(content);
        aiPassed = !!parsed.passed;
        aiFeedback = typeof parsed.feedback === "string" ? parsed.feedback : "";
      } catch {
        aiPassed = null;
      }
    } catch {
      aiPassed = null;
    }
  }

  // No AI opinion: fall back to syntax-only. If the AI passed code with syntax errors,
  // it missed them, so show the syntax error instead.
  if (aiPassed === null) {
    if (syntaxErrors.length > 0) {
      const first = syntaxErrors[0]!;
      return {
        passed: false,
        feedback: copy.syntax(first.message, first.file, first.line),
      };
    }
    return { passed: true, feedback: "" };
  }

  if (syntaxErrors.length > 0 && aiPassed) {
    const first = syntaxErrors[0]!;
    return {
      passed: false,
      feedback: copy.aiPassedWithSyntax(first.message, first.file, first.line),
    };
  }

  if (!aiPassed) {
    return { passed: false, feedback: aiFeedback || copy.aiFailedFallback };
  }

  return { passed: true, feedback: "" };
});
