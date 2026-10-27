// Retrieval only ranks; the model picks at most one entry in a single call,
// because a confidently wrong link is worse than no link.

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import db from "../db";
import { configuredAiKey } from "./ai-config";
import { cached } from "./cache";
import { aiChat, getDefaultAiModel, type ChatCompletionResponse } from "./hackclub-ai";

// all ride in one model call, so this is bounded by prompt size
const FAQ_CANDIDATES = 4;

export interface DocsPointer {
  title: string;
  url: string;
}

function publicBaseUrl(): string {
  return (
    process.env.NUXT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    "https://macondo.hackclub.com"
  ).replace(/\/+$/, "");
}

// Absolute because the body is mirrored into Slack; the anchor matches app/pages/docs/faq.vue.
function faqUrl(id: number): string {
  return `${publicBaseUrl()}/docs/faq#faq-${id}`;
}

// English only: Spanish needs the 'spanish' config, and mixed-config tsqueries match badly.
// Lexemes are OR'd (a question shares some FAQ words, never all) and quote_literal'd because
// URLs/emails contain tsquery metacharacters. NULLIF keeps an all-stopword question from throwing.
// No rank floor: ts_rank magnitude collapses on long tickets, only the ordering is reliable.
async function searchFaq(
  question: string,
): Promise<Array<{ id: number; question: string; answer: string }>> {
  const rows = (await db.execute(sql`
    WITH q AS (
      SELECT to_tsquery('english', NULLIF((
        SELECT string_agg(quote_literal(lex), ' | ')
        FROM unnest(tsvector_to_array(to_tsvector('english', ${question}))) AS lex
      ), '')) AS tsq
    )
    SELECT f.id, f.question_en AS question, f.answer_en AS answer,
           ts_rank(
             to_tsvector('english', f.question_en || ' ' || f.answer_en),
             q.tsq
           ) AS rank
    FROM faq_entries f, q
    WHERE q.tsq IS NOT NULL
      AND to_tsvector('english', f.question_en || ' ' || f.answer_en) @@ q.tsq
    ORDER BY rank DESC
    LIMIT ${FAQ_CANDIDATES}
  `)) as unknown;
  return ((Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as Array<{
    id: number | string;
    question: string;
    answer: string;
  }>).map((r) => ({
    id: typeof r.id === "string" ? Number(r.id) : r.id,
    question: r.question,
    answer: r.answer,
  }));
}

const PICK_ROLE =
  "You triage a student's help-desk question against a numbered shortlist " +
  "of FAQ entries. Reply with the number of the ONE entry that answers the " +
  "question, or 0 if none of them do. Reply with that number and nothing " +
  "else. Pick an entry only if reading it would let the student solve their " +
  "problem without waiting for a human. Sharing a topic, a keyword, or a " +
  "general area is not enough. The shortlist was built by keyword overlap, " +
  "so most of the time none of the entries actually answer the question and " +
  "0 is the correct reply. When unsure, reply 0.";

// 1-based pick, or null for none and on every failure: failing closed is the point.
async function pickAnsweringFaq(
  question: string,
  candidates: Array<{ id: number; question: string; answer: string }>,
): Promise<number | null> {
  const apiKey = configuredAiKey();
  if (!apiKey) return null;

  // a FAQ answer states its point up front, so the tail can be cut
  const shortlist = candidates
    .map((c, i) => `${i + 1}. Q: ${c.question}\n   A: ${c.answer.slice(0, 600)}`)
    .join("\n\n");
  const prompt =
    `Student's question:\n${question}\n\n` +
    `FAQ entries:\n${shortlist}\n\n` +
    `Which entry answers the question? Reply with a number from 1 to ${candidates.length}, or 0.`;

  // keyed on the shortlist too, so FAQ table changes get re-decided
  const digest = createHash("sha256")
    .update(`${candidates.map((c) => c.id).join(",")}\n${question}`)
    .digest("hex");

  let raw: string;
  try {
    raw = await cached(
      `ai:faq-pick:v1:${digest}`,
      365 * 24 * 60 * 60, // year-long faq pick cache ttl
      async () => {
        const res = await aiChat<ChatCompletionResponse>({
          apiKey,
          model: getDefaultAiModel(),
          body: {
            messages: [
              { role: "system", content: PICK_ROLE },
              { role: "user", content: prompt },
            ],
            max_tokens: 5,
            temperature: 0,
          },
        });
        const content = res?.choices?.[0]?.message?.content?.trim() ?? "";
        if (!content) throw new Error("FAQ pick unavailable");
        return content;
      },
      { staleSeconds: 0 },
    );
  } catch (err) {
    console.warn("[support-docs-pointer] faq pick failed", err);
    return null;
  }

  const match = raw.match(/\d+/);
  if (!match) return null;
  const picked = Number(match[0]);
  if (!Number.isInteger(picked) || picked < 1 || picked > candidates.length) {
    return null;
  }
  return picked;
}

// Never throws: this runs on the ticket-create path.
export async function findDocsPointers(ticket: {
  subject: string;
  body: string;
}): Promise<DocsPointer[]> {
  const question = `${ticket.subject}\n\n${ticket.body}`
    .trim()
    .slice(0, 1200);
  if (question.length === 0) return [];

  let candidates: Array<{ id: number; question: string; answer: string }>;
  try {
    candidates = await searchFaq(question);
  } catch (err) {
    console.error("[support-docs-pointer] faq search failed", err);
    return [];
  }
  if (candidates.length === 0) return [];

  const picked = await pickAnsweringFaq(question, candidates);
  if (picked == null) return [];
  const entry = candidates[picked - 1]!;
  return [{ title: entry.question, url: faqUrl(entry.id) }];
}
