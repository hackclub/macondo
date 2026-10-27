import { aiChat, getDefaultAiModel } from "./hackclub-ai";

const DIFFICULTIES = ["beginner", "intermediate", "advanced", "expert"] as const;
const KINDS = ["new_project", "project_update"] as const;
const CATEGORIES = ["software", "hardware"] as const;

// JSON keys, enum values and languages[] stay English so the parser and UI work in any locale.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

function languageNameFor(locale: string | undefined): string | null {
  if (!locale) return null;
  return LANGUAGE_NAMES[locale.toLowerCase().split(/[-_]/)[0] ?? locale.toLowerCase()] ?? null;
}

export type IdeaDifficulty = (typeof DIFFICULTIES)[number];
export type IdeaKind = (typeof KINDS)[number];
export type IdeaCategory = (typeof CATEGORIES)[number];

export interface IdeaResource {
  title: string;
  url: string;
}

export interface GeneratedIdea {
  title: string;
  description: string;
  reasoning: string;
  languages: string[];
  difficulty: IdeaDifficulty;
  kind: IdeaKind;
  category: IdeaCategory;
  existing_project_id: number | null;
  resources: IdeaResource[];
}

export interface IdeaGenerationProject {
  name: string;
  total_seconds: number;
  languages: string[];
}

export interface IdeaGenerationJournalSnippet {
  short_brief: string;
  long_brief: string;
}

export interface IdeaGenerationExistingProject {
  id: number;
  name: string;
  description: string;
  level: string | null;
  type: string;
  repository_url: string | null;
  recent_journals: IdeaGenerationJournalSnippet[];
  readme_excerpt: string | null;
}

export interface IdeaGenerationInput {
  totalHours: number;
  projects: IdeaGenerationProject[];
  latestHeartbeat: { project: string; language: string; entity: string } | null;
  existingProjects: IdeaGenerationExistingProject[];
  locale?: string;
  forceCategory?: IdeaCategory;
  // Overrides the hours-based difficulty.
  forceDifficulty?: IdeaDifficulty;
  count?: number;
  // Fed back as "do not repeat" so rerolls don't converge on the same archetype.
  recentTitles?: string[];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

function buildSystemPrompt(
  targetLanguageName: string | null,
  forceCategory: IdeaCategory | null,
  forceDifficulty: IdeaDifficulty | null,
  count: number,
): string {
  const single = count === 1;
  const lines: string[] = [];
  if (single && forceCategory) {
    lines.push(
      `You are a coding mentor for a teenage maker. Given a snapshot of the user's recent coding activity AND a list of projects they have already started, suggest exactly ONE concrete, achievable ${forceCategory} idea that matches their apparent skill level and reuses the languages and tools they already know.`,
    );
  } else {
    lines.push(
      `You are a coding mentor for a teenage maker. Given a snapshot of the user's recent coding activity AND a list of projects they have already started, suggest ${count} concrete, achievable next steps that match their apparent skill level and reuse the languages and tools they already know.`,
    );
  }
  lines.push(
    "Two kinds of suggestions are possible:",
    "- new_project: a brand new project they could start.",
    "- project_update: a specific feature or improvement to add to one of their EXISTING projects (so they can ship an update). Pick a real project from the existingProjects list and set existing_project_id to that project's id.",
    "Default heavily to new_project. Roughly 80% of your output should be new_project suggestions and roughly 20% should be project_update — and only when there is a clear, specific feature you can describe by referencing one of the project's devlog notes. With small batches the math collapses to: prefer new_project unless an existing project really does have an obvious next feature jumping off the devlogs. When you are asked for exactly one idea (count=1), pick new_project unless the existing project signal is strong enough that the update reads as obviously the right thing to build next.",
    "Project_update suggestions are ONLY valid when existingProjects is non-empty. Every entry in existingProjects already has recent devlogs by the time you see it; there are no devlog-less projects in that list. If existingProjects is empty, every output idea MUST be kind \"new_project\" with existing_project_id null, no exceptions. When you do output a project_update, ground it in concrete signal from the project's devlogs (what the user has been working on lately), README excerpt (what it does today), and repository URL. Quote or reference one of those devlog notes in the reasoning field so the user can see exactly why the feature is a fit.",
    "Your only output is a JSON array. No prose before or after, no markdown fences, no commentary. The array contains objects of shape {\"title\": string, \"description\": string, \"reasoning\": string, \"languages\": string[], \"difficulty\": \"beginner\" | \"intermediate\" | \"advanced\" | \"expert\", \"kind\": \"new_project\" | \"project_update\", \"category\": \"software\" | \"hardware\", \"existing_project_id\": number | null, \"resources\": Array<{\"title\": string, \"url\": string}>}.",
    "resources is a small array of 1 to 3 entries that point the user at concrete things to read or watch to learn how to actually build this idea. Use real, well-known landing URLs you are confident exist: workshops.hackclub.com (especially when relevant — e.g. workshops.hackclub.com/personal_website/, workshops.hackclub.com/snake/), MDN (developer.mozilla.org), the official docs site for the framework or library you suggest, p5js.org/learn/, threejs.org/manual, godotengine.org/learn, learn.adafruit.com, randomnerdtutorials.com, fastapi.tiangolo.com, kit.svelte.dev/docs/, docs.python.org. Each entry's title is short (under 60 chars) and describes what the link teaches (\"Three.js basics — official manual\", \"FastAPI quickstart\", \"Hack Club Snake workshop\"). url is an absolute https URL. Never invent a URL — if you are not sure a specific page exists, use the well-known root domain instead (e.g. https://developer.mozilla.org instead of a deep guessed slug). Do NOT include workshops.hackclub.com URLs that are not in the canonical list above unless you are certain.",
  );
  if (single && forceCategory) {
    lines.push(
      `The array must contain exactly one object. The category field MUST be "${forceCategory}". For a project_update suggestion, only pick from existingProjects whose type already matches "${forceCategory}"; if none match, return a new_project instead.`,
    );
  } else {
    lines.push(
      "Generate an even mix of software and hardware ideas. With 4 ideas the split is 2 software and 2 hardware. With 5 ideas the split is 2 of one and 3 of the other; pick whichever side matches the user's existing leaning. With 6 ideas the split is 3 and 3. The category field must accurately label each idea.",
    );
  }
  lines.push(
    "For project_update suggestions, the category MUST match the existing project's type (a software project gets a software update, a hardware project gets a hardware update). Never suggest a hardware feature for a software-only project.",
    "title is a punchy noun phrase, MAXIMUM 50 characters including spaces. Aim for 25 to 40 characters. The title is rendered in a tight card, so anything longer wraps awkwardly or gets truncated. If your phrasing exceeds 50 characters, rewrite it shorter (drop adjectives, drop \"a website that\", drop \"the user can\", just name the thing) before returning. Examples of good lengths: \"Keystroke Vine Garden\", \"Tree Photo of the Day\", \"Lo-fi Mystery Box\". For project_update ideas, the title describes the feature being added (not the existing project name) and follows the same length limit.",
    "description is 1 to 3 sentences that explains what the user would build or add.",
    "reasoning is one sentence that ties the idea to something the user has actually been working on (a project, a language, a recent file).",
    "PUSH THE USER OUTSIDE THEIR COMFORT ZONE. Most new_project ideas should introduce a language, framework, tool, hardware platform, or technique the user has NOT used before. The point is to widen their range, not rehash what they already know. Good stretches: a Python user trying Rust or Elixir, a TypeScript-only user trying p5.js or three.js or WebGL shaders, an HTML/CSS user trying SvelteKit or Astro or a Phaser game, a Pi/Arduino user trying an RP2040 in MicroPython, a soldering-iron-only person trying KiCad and OSH Park, a frontend dev trying CircuitPython on a Raspberry Pi Pico, a Vue dev trying Godot or Bevy for game dev. Pick adjacent territory that builds on something they know but lands them in a new room — not a hard left turn into an unrelated domain.",
    "languages array: list the languages and tools the idea actually uses, including new ones. The reasoning field should explicitly call out the stretch (for example, \"This is your first KiCad board\" or \"Trades your usual TypeScript for some hand-written shader code\"). It's fine if the user does not currently use any of the listed languages — that's the point.",
    "VARY THEMES across rerolls. Do not lean on the same archetypes over and over. Specifically, avoid overusing: clap-activated anything, mood rings, fortune-teller bots, generic Discord bots, simple LED-on-trigger gadgets, MEMS sensor demos, weather-haiku printers, jukebox-of-X concepts. If you have produced something close to one of these patterns recently, pivot to a genuinely different shape: a small game, a generative art piece, a puzzle, a network toy, a robotics build, a CV/ML doodle, a synth, a printer plotter, a wearable that does something specific, a board with sensors used in an unusual way, a creative collaboration tool, a tool that solves a specific niche annoyance. Surprise the user.",
    forceDifficulty
      ? `The user explicitly requested difficulty "${forceDifficulty}" for this roll. Every output idea MUST have difficulty "${forceDifficulty}", regardless of total hours. Tailor the scope so it actually IS a ${forceDifficulty}-level project: a beginner pick should be doable in a single sitting with starter docs, an expert pick should genuinely involve advanced work the user has not done before.`
      : "difficulty must reflect where the user already is, not a stretch goal far above them. Use total hours as the primary signal: under 20h skews beginner, 20 to 100h skews intermediate, 100 to 300h skews advanced, above 300h is expert territory.",
    "For project_update ideas, existing_project_id MUST exactly match an id from the existingProjects list. For new_project ideas, set existing_project_id to null.",
    "Avoid vague ideas like \"build a portfolio\" or \"a clone of X\". Each idea should describe something specific enough that the user can imagine the first commit.",
    "Be playful. The audience is teenage makers, not enterprise devs. Boring CRUD or devops ideas are explicitly off-limits. Specifically forbidden: anything CI-related (GitHub Actions, CircleCI, Jenkins, Travis, GitLab CI, automated test pipelines, lint-on-push workflows, deploy automation), \"a CLI to parse CSV configs\", \"a YAML validator\", \"a generic todo list\", \"a markdown to HTML converter\", \"a personal portfolio site\", and any \"add tests / coverage / linting / formatting / pre-commit hooks\" suggestions. Do not output a suggestion that fits any of these categories under any circumstance.",
    "Do not center ideas on Git or GitHub mechanics. That means no \"commit-message-driven\" anything, no \"reacts to your last push\", no contribution-graph art, no PR-badge generators, no README ornaments, no repo dashboards. The repo is just where the code lives, not the spark for the idea. If a GitHub API shows up at all it should be incidental to a more interesting idea, not the whole hook.",
    "Mix software AND hardware ideas. Hardware suggestions are welcome and encouraged: microcontrollers (ESP32, RP2040, Arduino, Pi Pico), wearables, e-paper displays, LED matrices, mechanical keyboards, sensor-driven art, 3D-printed enclosures, soldered PCBs, robots, badges. Hardware ideas should still be specific enough to picture the BOM (which board, which sensor, what it physically does) and they should be silly or expressive, not industrial. If the user already has hardware projects in existingProjects, lean harder toward hardware suggestions and updates.",
    "Aim for ideas that sound fun out loud. Lean toward things you can show a friend without a long explanation: small content websites, generative interactive websites, weird games, ambient gadgets. Use the word \"website\" — never \"web page\", \"web toy\", or \"web app\". Software examples: a website that shows a different photograph of a tree every time you load it with a one-line note from the photographer, a virtual aquarium website where each fish is a song from your library and the fish that swim closest are the ones you have played most, a website that picks a random Wikipedia article every morning and re-renders it like a vintage postcard, a website that recommends a movie based on the current weather, a website that generates fake cafe menus from imaginary mountain towns, a chrome extension that replaces every image on the page with a cat unless the website is about cats, a discord bot that picks the most cursed photo from a channel and writes a haiku about it, a website where typing words grows an algorithmic plant, a website that turns your screen time into a guilt-trip postcard from your future self, a tiny dating-sim website where the date is actually your houseplants. Hardware examples: an ESP32 desk sign that paints rolling color clouds based on the room's noise level, an e-paper picture frame that cycles a curated list of public-domain art, a 3D-printed dice tower that flashes a quiet rainbow on a nat 20, a clap-activated mood lamp, a Pi-driven thermal printer that prints a tiny weather poem every morning, a wooden box that plays a different lo-fi loop when you open the lid, a CO2 sensor that yells \"open a window\" through a tiny speaker, a doormat made from pressure sensors that lights up a friendly hello when stepped on. Lean weird and a little wholesome, leave room for personality.",
    "For beginners specifically, the bar for whimsical is highest: their first project should be something they cannot wait to show a friend. For advanced and expert ideas you can pick more substantial builds (a real-time multiplayer game, a hardware-software hybrid, a tool with actual users), but they should still have a fun hook, not read like a job interview portfolio piece.",
  );
  if (targetLanguageName && targetLanguageName !== "English") {
    lines.push(
      `Write the title, description, and reasoning fields in ${targetLanguageName}. JSON object keys, the kind enum values ("new_project", "project_update"), the difficulty enum values ("beginner", "intermediate", "advanced", "expert"), and entries in the languages array must remain in English exactly as specified. Programming language names like Python and JavaScript stay in English everywhere.`,
    );
  }
  return lines.join(" ");
}

// User-controlled names go into the prompt verbatim; cap them so they can't stretch or derail it.
const PROMPT_NAME_CAP = 100;
function clipName(value: string): string {
  if (value.length <= PROMPT_NAME_CAP) return value;
  return value.slice(0, PROMPT_NAME_CAP - 1) + "…";
}

function buildUserPrompt(input: IdeaGenerationInput, targetLanguageName: string | null): string {
  const lines: string[] = [];
  lines.push(`Total Hackatime hours: ${Math.round(input.totalHours)}`);
  if (targetLanguageName && targetLanguageName !== "English") {
    lines.push(
      `Write title, description, and reasoning in ${targetLanguageName}. Keep JSON keys, enum values, and the languages array in English.`,
    );
  }

  const top = [...input.projects]
    .filter((p) => p.total_seconds > 0)
    .sort((a, b) => b.total_seconds - a.total_seconds)
    .slice(0, 8);

  if (top.length > 0) {
    lines.push("");
    lines.push("Top projects (by hours):");
    for (const p of top) {
      const hrs = Math.max(0.1, p.total_seconds / 3600).toFixed(1); // seconds to hours, min 0.1h
      const langs = p.languages.length > 0 ? clipName(p.languages.join(", ")) : "unknown";
      lines.push(`- ${clipName(p.name)} (${hrs}h, languages: ${langs})`);
    }
  } else {
    lines.push("No per-project activity data available.");
  }

  if (input.latestHeartbeat) {
    lines.push("");
    lines.push(
      `Currently editing: ${clipName(input.latestHeartbeat.entity || "unknown file")} in project "${clipName(input.latestHeartbeat.project || "unknown")}" (${clipName(input.latestHeartbeat.language || "unknown language")})`,
    );
  }

  if (input.recentTitles && input.recentTitles.length > 0) {
    lines.push("");
    lines.push("Ideas you have already suggested to this user recently. Do NOT repeat any of these themes, mechanics, or core concepts. The new idea must read as genuinely different from every entry below:");
    for (const t of input.recentTitles.slice(0, 12)) { // only the 12 most recent
      lines.push(`- ${clipName(t)}`);
    }
  }

  if (input.existingProjects.length > 0) {
    lines.push("");
    lines.push("existingProjects (use these ids verbatim for any project_update suggestion):");
    for (const p of input.existingProjects) {
      const desc = p.description.length > 200 ? `${p.description.slice(0, 200)}...` : p.description;
      lines.push(`- id ${p.id}: "${clipName(p.name)}" [${p.type}, level ${p.level ?? "?"}]`);
      lines.push(`  description: ${desc}`);
      if (p.repository_url) {
        lines.push(`  repo: ${clipName(p.repository_url)}`);
      }
      if (p.recent_journals.length > 0) {
        lines.push("  recent devlogs (newest first):");
        for (const j of p.recent_journals) {
          const briefTitle = j.short_brief.trim().slice(0, 120);
          const briefBody = j.long_brief.replace(/\s+/g, " ").trim().slice(0, 240);
          lines.push(`    - ${briefTitle}${briefBody ? ` -- ${briefBody}` : ""}`);
        }
      }
      if (p.readme_excerpt) {
        lines.push(`  readme excerpt: ${p.readme_excerpt.replace(/\s+/g, " ").trim().slice(0, 600)}`); // cap the excerpt at 600 chars
      }
    }
  } else {
    lines.push("");
    lines.push("existingProjects is empty. Every suggestion must be kind \"new_project\" with existing_project_id null.");
  }

  lines.push("");
  if (input.count === 1 && input.forceCategory) {
    const tier = input.forceDifficulty ? ` ${input.forceDifficulty}` : "";
    lines.push(
      `Suggest exactly ONE${tier} ${input.forceCategory} idea as a JSON array of length 1, following the schema in the system prompt.`,
    );
  } else {
    lines.push(
      `Suggest ${input.count ?? 4} to ${(input.count ?? 4) + 2} ideas as a JSON array following the schema in the system prompt. Split them evenly between software and hardware.`,
    );
  }
  return lines.join("\n");
}

function stripJsonFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "");
    s = s.replace(/```\s*$/i, "");
  }
  return s.trim();
}

function coerceResources(raw: unknown): IdeaResource[] {
  if (!Array.isArray(raw)) return [];
  const out: IdeaResource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 80) : "";
    const url = typeof o.url === "string" ? o.url.trim() : "";
    if (!title || !url) continue;
    if (!/^https:\/\/[^\s]+$/i.test(url)) continue;
    out.push({ title, url });
    if (out.length >= 4) break;
  }
  return out;
}

function coerceIdea(
  item: unknown,
  projectTypeById: Map<number, IdeaCategory>,
  forceDifficulty: IdeaDifficulty | null,
): GeneratedIdea | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const description = typeof o.description === "string" ? o.description.trim() : "";
  if (!title || !description) return null;
  const rawDiff = typeof o.difficulty === "string" ? o.difficulty.toLowerCase().trim() : "intermediate";
  let difficulty: IdeaDifficulty = (DIFFICULTIES as readonly string[]).includes(rawDiff)
    ? (rawDiff as IdeaDifficulty)
    : "intermediate";
  if (forceDifficulty) difficulty = forceDifficulty;

  const rawCategory = typeof o.category === "string" ? o.category.toLowerCase().trim() : "software";
  let category: IdeaCategory = (CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as IdeaCategory)
    : "software";

  const rawKind = typeof o.kind === "string" ? o.kind.toLowerCase().trim() : "new_project";
  let kind: IdeaKind = (KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as IdeaKind)
    : "new_project";
  let existingProjectId: number | null = null;
  if (kind === "project_update") {
    const raw = o.existing_project_id;
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && projectTypeById.has(parsed)) {
      existingProjectId = parsed;
      // The prompt asks for this too; enforce it in case the model slips.
      category = projectTypeById.get(parsed)!;
    } else {
      // Hallucinated id: keep the idea as a new_project instead of dropping it.
      kind = "new_project";
    }
  }

  // The prompt caps titles at 50 chars but the model overshoots; 60 spares near-misses.
  return {
    title: title.length > 60 ? title.slice(0, 57).trimEnd() + "..." : title,
    description,
    reasoning: typeof o.reasoning === "string" ? o.reasoning.trim() : "",
    languages: Array.isArray(o.languages)
      ? o.languages.filter((l): l is string => typeof l === "string" && l.trim().length > 0).map((l) => l.trim())
      : [],
    category,
    difficulty,
    kind,
    existing_project_id: existingProjectId,
    resources: coerceResources(o.resources),
  };
}

export async function generateIdeas(input: IdeaGenerationInput): Promise<GeneratedIdea[]> {
  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: "AI is not configured on this server.",
    });
  }

  const targetLanguageName = languageNameFor(input.locale);
  const requestedCount = input.count ?? 4;
  const forceCategory = input.forceCategory ?? null;
  const forceDifficulty = input.forceDifficulty ?? null;
  const systemPrompt = buildSystemPrompt(targetLanguageName, forceCategory, forceDifficulty, requestedCount);
  const userPrompt = buildUserPrompt(input, targetLanguageName);

  // The nonce defeats proxy dedupe of identical bodies; higher temperature loosens mode collapse.
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  let res: ChatCompletionResponse;
  try {
    res = await aiChat<ChatCompletionResponse>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "system", content: `nonce:${nonce}` },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1500,
        temperature: 1.1,
        top_p: 0.95,
      },
    });
  } catch (err) {
    console.error("[idea-generation] AI call failed", err);
    throw createError({
      statusCode: 502,
      statusMessage: "Could not generate ideas right now.",
    });
  }

  const raw = res?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw) {
    throw createError({ statusCode: 502, statusMessage: "AI returned no content." });
  }

  const stripped = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    // Don't log raw LLM output: it may echo user-controlled strings.
    console.error(
      `[idea-generation] JSON parse failed (raw length: ${raw.length})`,
      err,
    );
    throw createError({ statusCode: 502, statusMessage: "AI returned malformed JSON." });
  }

  if (!Array.isArray(parsed)) {
    throw createError({ statusCode: 502, statusMessage: "AI did not return a JSON array." });
  }

  const projectTypeById = new Map<number, IdeaCategory>();
  for (const p of input.existingProjects) {
    projectTypeById.set(p.id, p.type === "hardware" ? "hardware" : "software");
  }
  const ideas = parsed
    .map((item) => coerceIdea(item, projectTypeById, forceDifficulty))
    .filter((i): i is GeneratedIdea => i !== null);

  if (ideas.length === 0) {
    throw createError({ statusCode: 502, statusMessage: "AI returned no usable ideas." });
  }

  // If nothing matches the forced category, relabel the first idea rather than 502.
  if (forceCategory) {
    const matching = ideas.filter((i) => i.category === forceCategory);
    if (matching.length > 0) {
      return matching.slice(0, requestedCount === 1 ? 1 : 6); // max ideas when forcing a category
    }
    return [{ ...ideas[0]!, category: forceCategory }];
  }

  return ideas.slice(0, 6);
}
