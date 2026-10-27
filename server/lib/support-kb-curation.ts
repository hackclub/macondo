
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { useRuntimeConfig } from "#imports";

import db from "../db";
import {
  kbSuggestionTable,
  supportTicketMessageTable,
  supportTicketTable,
  users,
} from "../db/schema";
import { anonymizeFeedback } from "./anonymize-feedback";
import { aiChat, getDefaultAiModel } from "./hackclub-ai";
import { embedTicket } from "./support-ticket-embedding";

const MAX_TICKETS = 100;
const MIN_MSG_CHARS = 12;
const MAX_MSG_CHARS = 1200;
const PROMPT_MSG_CAP = 600;
const PROMPT_FIELD_CAP = 400;

// contradictions go to the most senior (then most recent) answer; rank 0 means non-staff
const SENIORITY_RANK: Record<string, number> = {
  supaadmin: 100,
  admin: 90,
  hq: 80,
  software_reviewer: 70,
  hardware_reviewer: 70,
  support: 60,
};

function seniorityOf(roles: string[] | null | undefined): number {
  if (!roles || roles.length === 0) return 0;
  let max = 0;
  for (const r of roles) {
    const rank = SENIORITY_RANK[r] ?? 0;
    if (rank > max) max = rank;
  }
  return max;
}

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return "";
  return value.length <= max ? value : value.slice(0, max) + "…";
}

function normalizeForDedup(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function stripDashes(s: string): string {
  return s.replace(/\u2014/g, ", ").replace(/-{2}/g, ", ");
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface CorpusTicket {
  id: number;
  subject: string;
  body: string;
  category: string;
  owner_id: string;
  created_at: Date;
  embedding: number[] | null;
}

interface Cluster {
  tickets: CorpusTicket[];
  fullSize: number;
}

interface StaffReply {
  ticket_id: number;
  author_id: string;
  seniority: number;
  created_at: Date;
  body: string;
}

interface Citation {
  ticket_id: number;
  snippet: string;
}

interface Candidate {
  question_en: string;
  answer_en: string;
  category: string;
  source_ticket_ids: number[];
  source_ticket_count: number;
  citations: Citation[];
  raw_ai_response: string;
}

export interface KbCurationResult {
  ticketsAnalyzed: number;
  clustersFound: number;
  suggestionsCreated: number;
  duplicatesSkipped: number;
}

export interface KbCurationOptions {
  windowDays?: number;
  maxTickets?: number;
}

// greedy single-link clustering: cheap, and the human review queue is the real quality gate
function clusterTickets(corpus: CorpusTicket[]): Cluster[] {
  const embedded = corpus.filter(
    (t) => t.embedding && t.embedding.length > 0,
  );
  const visited = new Set<number>();
  const clusters: Cluster[] = [];
  for (const seed of embedded) {
    if (visited.has(seed.id)) continue;
    visited.add(seed.id);
    const members: CorpusTicket[] = [seed];
    for (const other of embedded) {
      if (visited.has(other.id)) continue;
      // text-embedding-3-small cosines run low (match ~0.6, unrelated ~0.22); review catches loose merges
      if (cosine(seed.embedding!, other.embedding!) >= 0.6) {
        visited.add(other.id);
        members.push(other);
      }
    }
    if (members.length < 2) continue;
    const newestFirst = [...members].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    );
    clusters.push({
      // newest few only, to bound tokens and bias toward current answers
      tickets: newestFirst.slice(0, 3),
      fullSize: members.length,
    });
  }
  clusters.sort((a, b) => b.fullSize - a.fullSize);
  return clusters.slice(0, 8);
}

async function loadStaffReplies(
  clusters: Cluster[],
): Promise<Map<number, StaffReply[]>> {
  const ticketIds = clusters.flatMap((c) => c.tickets.map((t) => t.id));
  const ownerById = new Map<number, string>();
  for (const c of clusters) {
    for (const t of c.tickets) ownerById.set(t.id, t.owner_id);
  }
  if (ticketIds.length === 0) return new Map();

  const rows = await db
    .select({
      ticket_id: supportTicketMessageTable.ticket_id,
      author_user_id: supportTicketMessageTable.author_user_id,
      author_kind: supportTicketMessageTable.author_kind,
      body: supportTicketMessageTable.body,
      created_at: supportTicketMessageTable.created_at,
      roles: users.roles,
    })
    .from(supportTicketMessageTable)
    .leftJoin(users, eq(supportTicketMessageTable.author_user_id, users.id))
    .where(
      and(
        inArray(supportTicketMessageTable.ticket_id, ticketIds),
        eq(supportTicketMessageTable.is_internal_note, false),
        isNull(supportTicketMessageTable.deleted_at),
      ),
    )
    .orderBy(asc(supportTicketMessageTable.created_at));

  const byTicket = new Map<number, StaffReply[]>();
  for (const r of rows) {
    if (r.author_kind !== "user" || !r.author_user_id) continue;
    if (r.author_user_id === ownerById.get(r.ticket_id)) continue;
    const seniority = seniorityOf(r.roles);
    if (seniority <= 0) continue;
    const clean = anonymizeFeedback(r.body).trim();
    const list = byTicket.get(r.ticket_id) ?? [];
    const last = list[list.length - 1];
    if (last && last.author_id === r.author_user_id) {
      last.body = `${last.body}\n${clean}`.slice(0, MAX_MSG_CHARS);
      if (r.created_at > last.created_at) last.created_at = r.created_at;
    } else {
      list.push({
        ticket_id: r.ticket_id,
        author_id: r.author_user_id,
        seniority,
        created_at: r.created_at,
        body: clean,
      });
    }
    byTicket.set(r.ticket_id, list);
  }

  for (const [ticketId, list] of byTicket) {
    byTicket.set(
      ticketId,
      list.filter(
        (b) => b.body.length >= MIN_MSG_CHARS && b.body.length <= MAX_MSG_CHARS,
      ),
    );
  }
  return byTicket;
}

function majorityCategory(tickets: CorpusTicket[]): string {
  const counts = new Map<string, number>();
  for (const t of tickets) {
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  }
  let best = "general";
  let bestN = -1;
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = cat;
      bestN = n;
    }
  }
  return best;
}

function buildClusterBlock(
  cluster: Cluster,
  replies: Map<number, StaffReply[]>,
): string {
  return cluster.tickets
    .map((t) => {
      const staff = (replies.get(t.id) ?? []).sort(
        (a, b) =>
          b.seniority - a.seniority ||
          b.created_at.getTime() - a.created_at.getTime(),
      );
      const repliesBlock = staff.length
        ? staff
            .map(
              (s) =>
                `    - (staff seniority ${s.seniority}) ${truncate(
                  s.body,
                  PROMPT_MSG_CAP,
                )}`,
            )
            .join("\n")
        : "    (no support reply)";
      return [
        `#${t.id} [${t.category}]`,
        `  Question: ${truncate(
          anonymizeFeedback(`${t.subject} ${t.body}`),
          PROMPT_FIELD_CAP,
        )}`,
        `  Support replies:`,
        repliesBlock,
      ].join("\n");
    })
    .join("\n\n");
}

function coerceCitations(value: unknown, allowed: Set<number>): Citation[] {
  if (!Array.isArray(value)) return [];
  const out: Citation[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const obj = v as Record<string, unknown>;
    const idRaw = obj.ticket_id;
    const id =
      typeof idRaw === "number"
        ? Math.trunc(idRaw)
        : typeof idRaw === "string" && /^\d+$/.test(idRaw)
          ? parseInt(idRaw, 10)
          : null;
    if (id == null || !allowed.has(id)) continue;
    const snippet =
      typeof obj.snippet === "string" ? stripDashes(obj.snippet.trim()) : "";
    if (!snippet) continue;
    out.push({ ticket_id: id, snippet: truncate(snippet, PROMPT_MSG_CAP) });
  }
  return out;
}

async function synthesizeCluster(
  cluster: Cluster,
  replies: Map<number, StaffReply[]>,
  apiKey: string,
): Promise<Candidate | null> {
  const ticketIds = cluster.tickets.map((t) => t.id);
  const allowed = new Set(ticketIds);

  const systemPrompt =
    `You curate a knowledge base for Macondo, a youth coding program where ` +
    `teenagers (ages 13 to 18) build projects and earn rewards. You receive ` +
    `a cluster of resolved support tickets that asked the same question, each ` +
    `with the support team's replies. Write ONE knowledge base entry that ` +
    `answers the shared question, grounded ONLY in the support replies shown. ` +
    `If the supporters contradict each other, prefer the reply from the most ` +
    `senior staff member (higher seniority number), and break ties by recency. ` +
    `Output strict JSON: {"question_en":"...","answer_en":"...",` +
    `"source_ticket_ids":[1,2],"citations":[{"ticket_id":1,"snippet":"..."}]}. ` +
    `Rules: answer under 80 words, warm and direct for a teen audience; ground ` +
    `only in the provided replies, never invent facts; do not use em dashes or ` +
    `double hyphens, use commas or periods instead; every citation ticket_id ` +
    `must be one of the ticket ids shown; snippets must be a short quote from ` +
    `that ticket's support reply. Respond with ONLY the JSON object, no ` +
    `markdown fencing, no prose.`;

  const userMessage = `=== CLUSTER (${cluster.fullSize} similar tickets) ===\n${buildClusterBlock(cluster, replies)}\n\nReturn JSON only.`;

  let rawContent = "";
  try {
    const res = await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 900,
        temperature: 0.2,
      },
    });
    rawContent = (res.choices?.[0]?.message?.content ?? "").trim();
  } catch (err) {
    console.error("[support-kb-curation] AI call failed", err);
    return null;
  }

  const jsonText = (() => {
    const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return fenced[1]!.trim();
    const start = rawContent.indexOf("{");
    const end = rawContent.lastIndexOf("}");
    if (start >= 0 && end > start) return rawContent.slice(start, end + 1);
    return rawContent;
  })();

  let questionEn = "";
  let answerEn = "";
  let citations: Citation[] = [];
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>;
    questionEn =
      typeof obj.question_en === "string"
        ? stripDashes(obj.question_en.trim())
        : "";
    answerEn =
      typeof obj.answer_en === "string"
        ? stripDashes(obj.answer_en.trim())
        : "";
    citations = coerceCitations(obj.citations, allowed);
  } catch (err) {
    console.warn("[support-kb-curation] JSON parse failed", err);
    return null;
  }

  if (!questionEn || !answerEn) return null;

  // the accept handler requires >= 1 source, so fall back to the tickets' own text
  if (citations.length === 0) {
    citations = cluster.tickets.map((t) => ({
      ticket_id: t.id,
      snippet: truncate(anonymizeFeedback(`${t.subject} ${t.body}`), 200), // cap snippet length
    }));
  }

  return {
    question_en: questionEn,
    answer_en: answerEn,
    category: majorityCategory(cluster.tickets),
    source_ticket_ids: ticketIds,
    source_ticket_count: cluster.fullSize,
    citations,
    raw_ai_response: rawContent,
  };
}

export async function runKbCuration(
  opts: KbCurationOptions = {},
): Promise<KbCurationResult> {
  const config = useRuntimeConfig();
  const apiKey = config.hackclubAiKey as string | undefined;
  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: "AI service not configured",
    });
  }

  const corpus: CorpusTicket[] = (
    await db
      .select({
        id: supportTicketTable.id,
        subject: supportTicketTable.subject,
        body: supportTicketTable.body,
        category: supportTicketTable.category,
        owner_id: supportTicketTable.user_id,
        created_at: supportTicketTable.created_at,
        embedding: supportTicketTable.embedding,
      })
      .from(supportTicketTable)
      .where(
        and(
          gte(
            supportTicketTable.created_at,
            new Date(Date.now() - (opts.windowDays ?? 30) * 24 * 60 * 60 * 1000), // default 30-day window
          ),
          inArray(supportTicketTable.status, ["resolved", "closed"]),
        ),
      )
      .orderBy(desc(supportTicketTable.created_at))
      .limit(Math.min(opts.maxTickets ?? MAX_TICKETS, MAX_TICKETS))
  ).map((r) => ({
    id: r.id,
    subject: r.subject,
    body: r.body,
    category: r.category,
    owner_id: r.owner_id,
    created_at: r.created_at,
    embedding: r.embedding,
  }));

  if (corpus.length === 0) {
    return {
      ticketsAnalyzed: 0,
      clustersFound: 0,
      suggestionsCreated: 0,
      duplicatesSkipped: 0,
    };
  }

  // embedTicket persists the vector, so the next run pays nothing for these rows
  for (const t of corpus) {
    if (!t.embedding || t.embedding.length === 0) {
      t.embedding = await embedTicket({
        id: t.id,
        subject: t.subject,
        body: t.body,
        embedding: t.embedding,
      });
    }
  }

  const clusters = clusterTickets(corpus);
  if (clusters.length === 0) {
    return {
      ticketsAnalyzed: corpus.length,
      clustersFound: 0,
      suggestionsCreated: 0,
      duplicatesSkipped: 0,
    };
  }

  const replies = await loadStaffReplies(clusters);

  const candidates: Candidate[] = [];
  for (const cluster of clusters) {
    const candidate = await synthesizeCluster(cluster, replies, apiKey);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return {
      ticketsAnalyzed: corpus.length,
      clustersFound: clusters.length,
      suggestionsCreated: 0,
      duplicatesSkipped: 0,
    };
  }

  const existing = await db
    .select({ question_en: kbSuggestionTable.question_en })
    .from(kbSuggestionTable)
    .where(
      or(
        eq(kbSuggestionTable.status, "pending"),
        eq(kbSuggestionTable.status, "accepted"),
      ),
    );
  const seen = new Set(existing.map((e) => normalizeForDedup(e.question_en)));

  const fresh: Candidate[] = [];
  for (const c of candidates) {
    const key = normalizeForDedup(c.question_en);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(c);
  }

  if (fresh.length > 0) {
    await db.insert(kbSuggestionTable).values(
      fresh.map((c) => ({
        question_en: c.question_en,
        answer_en: c.answer_en,
        question_es: null,
        answer_es: null,
        status: "pending" as const,
        category: c.category,
        source_ticket_count: c.source_ticket_count,
        source_ticket_ids: c.source_ticket_ids,
        citations: c.citations,
        raw_ai_response: c.raw_ai_response,
      })),
    );
  }

  return {
    ticketsAnalyzed: corpus.length,
    clustersFound: clusters.length,
    suggestionsCreated: fresh.length,
    duplicatesSkipped: candidates.length - fresh.length,
  };
}

// Never auto-promoted (anti-poisoning guard): drafts go to the review queue. Swallows all errors.
export async function draftKbSuggestionFromResolvedTicket(
  ticketId: number,
): Promise<void> {
  try {
    const config = useRuntimeConfig();
    const apiKey = config.hackclubAiKey as string | undefined;
    if (!apiKey) return;

    const [ticket] = await db
      .select({
        id: supportTicketTable.id,
        subject: supportTicketTable.subject,
        body: supportTicketTable.body,
        category: supportTicketTable.category,
        owner_id: supportTicketTable.user_id,
      })
      .from(supportTicketTable)
      .where(eq(supportTicketTable.id, ticketId))
      .limit(1);
    if (!ticket) return;

    const rows = await db
      .select({
        author_user_id: supportTicketMessageTable.author_user_id,
        author_kind: supportTicketMessageTable.author_kind,
        body: supportTicketMessageTable.body,
        created_at: supportTicketMessageTable.created_at,
        roles: users.roles,
      })
      .from(supportTicketMessageTable)
      .leftJoin(users, eq(supportTicketMessageTable.author_user_id, users.id))
      .where(
        and(
          eq(supportTicketMessageTable.ticket_id, ticketId),
          eq(supportTicketMessageTable.is_internal_note, false),
          isNull(supportTicketMessageTable.deleted_at),
        ),
      )
      .orderBy(asc(supportTicketMessageTable.created_at));

    const staff: {
      author_id: string;
      seniority: number;
      created_at: Date;
      body: string;
    }[] = [];
    for (const r of rows) {
      if (r.author_kind !== "user" || !r.author_user_id) continue;
      if (r.author_user_id === ticket.owner_id) continue;
      const seniority = seniorityOf(r.roles);
      if (seniority <= 0) continue;
      const clean = anonymizeFeedback(r.body).trim();
      const last = staff[staff.length - 1];
      if (last && last.author_id === r.author_user_id) {
        last.body = `${last.body}\n${clean}`.slice(0, MAX_MSG_CHARS);
        if (r.created_at > last.created_at) last.created_at = r.created_at;
      } else {
        staff.push({
          author_id: r.author_user_id,
          seniority,
          created_at: r.created_at,
          body: clean,
        });
      }
    }
    const substantive = staff.filter(
      (s) => s.body.length >= MIN_MSG_CHARS && s.body.length <= MAX_MSG_CHARS,
    );
    if (substantive.length === 0) return;

    const [cited] = await db
      .select({ id: kbSuggestionTable.id })
      .from(kbSuggestionTable)
      .where(
        and(
          or(
            eq(kbSuggestionTable.status, "pending"),
            eq(kbSuggestionTable.status, "accepted"),
          ),
          sql`${kbSuggestionTable.source_ticket_ids} @> ${JSON.stringify([ticket.id])}::jsonb`,
        ),
      )
      .limit(1);
    if (cited) return;

    // cheap raw-subject check before paying for the LLM
    const existing = await db
      .select({ question_en: kbSuggestionTable.question_en })
      .from(kbSuggestionTable)
      .where(
        or(
          eq(kbSuggestionTable.status, "pending"),
          eq(kbSuggestionTable.status, "accepted"),
        ),
      );
    const seen = new Set(existing.map((e) => normalizeForDedup(e.question_en)));
    if (seen.has(normalizeForDedup(ticket.subject))) return;

    // Most senior, then most recent, reply is the canonical answer.
    const ordered = [...substantive].sort(
      (a, b) =>
        b.seniority - a.seniority ||
        b.created_at.getTime() - a.created_at.getTime(),
    );
    const repliesBlock = ordered
      .map(
        (s) =>
          `- (staff seniority ${s.seniority}) ${truncate(s.body, PROMPT_MSG_CAP)}`,
      )
      .join("\n");

    const systemPrompt =
      `You curate a knowledge base for Macondo, a youth coding program (ages 13 to 18). ` +
      `You receive one resolved support ticket: the student's question and the support ` +
      `team's replies. Write ONE knowledge base entry capturing the question and the ` +
      `answer, grounded ONLY in the replies shown. Output strict JSON: ` +
      `{"question_en":"...","answer_en":"..."}. Rules: answer under 80 words, warm and ` +
      `direct, ground only in the replies, never invent facts, do not use em dashes or ` +
      `double hyphens. Respond with ONLY the JSON object, no markdown fencing, no prose.`;
    const userMessage =
      `=== TICKET #${ticket.id} [${ticket.category}] ===\n` +
      `Question: ${truncate(anonymizeFeedback(`${ticket.subject} ${ticket.body}`), PROMPT_FIELD_CAP)}\n` +
      `Support replies:\n${repliesBlock}\n\nReturn JSON only.`;

    let rawContent = "";
    try {
      const res = await aiChat<{ choices: { message: { content: string } }[] }>(
        {
          apiKey,
          model: getDefaultAiModel(),
          body: {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            max_tokens: 700,
            temperature: 0.2,
          },
        },
      );
      rawContent = (res.choices?.[0]?.message?.content ?? "").trim();
    } catch (err) {
      console.error(
        "[support-kb-curation] learning-loop AI call failed",
        ticketId,
        err,
      );
      return;
    }

    const jsonText = (() => {
      const fenced = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced) return fenced[1]!.trim();
      const start = rawContent.indexOf("{");
      const end = rawContent.lastIndexOf("}");
      if (start >= 0 && end > start) return rawContent.slice(start, end + 1);
      return rawContent;
    })();

    let questionEn = "";
    let answerEn = "";
    try {
      const obj = JSON.parse(jsonText) as Record<string, unknown>;
      questionEn =
        typeof obj.question_en === "string"
          ? stripDashes(obj.question_en.trim())
          : "";
      answerEn =
        typeof obj.answer_en === "string"
          ? stripDashes(obj.answer_en.trim())
          : "";
    } catch {
      return;
    }
    if (!questionEn || !answerEn) return;

    // re-check the LLM-written question; the raw subject rarely matches model phrasing
    if (seen.has(normalizeForDedup(questionEn))) return;

    await db.insert(kbSuggestionTable).values({
      question_en: questionEn,
      answer_en: answerEn,
      question_es: null,
      answer_es: null,
      status: "pending",
      category: ticket.category,
      source_ticket_count: 1,
      source_ticket_ids: [ticket.id],
      citations: [
        { ticket_id: ticket.id, snippet: truncate(ordered[0]!.body, PROMPT_MSG_CAP) },
      ],
      raw_ai_response: rawContent,
    });
  } catch (err) {
    console.error(
      "[support-kb-curation] learning-loop draft failed",
      ticketId,
      err,
    );
  }
}
