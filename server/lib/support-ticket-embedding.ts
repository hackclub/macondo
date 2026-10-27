// Suggestions link the public Slack thread, since the in-app ticket page 404s for non-owners.
// Entry points are fire-and-forget: failures must never block ticket creation or resolution.

import { eq, sql } from "drizzle-orm";

import db from "../db";
import { supportTicketMessageTable, supportTicketTable } from "../db/schema";
import { aiEmbed } from "./hackclub-ai";
import { findDocsPointers, type DocsPointer } from "./support-docs-pointer";
import { publishMessageAdded } from "./support-ticket-realtime";
import { hasEnoughSubstance } from "./support-ticket-substance";
import { postPublicThreadReply, slackThreadUrl } from "./support-ticket-slack";

export const CAPYBARA_USERNAME = "Capybara";
export const SIMILAR_TICKET_MIN_SIMILARITY = 0.8;

export const SIMILAR_TICKET_LIMIT = 3;

export function buildTicketText(ticket: {
  subject: string;
  body: string;
}): string {
  return `${ticket.subject}\n\n${ticket.body}`.trim().slice(0, 6000); // tighter than aiEmbed's own cap
}

// inlined as raw SQL to avoid postgres-js reshaping params; pure numbers, so no injection surface
function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// Re-reads the row before paying for the vector so a parallel caller skips the spend;
// the trailing UPDATE still races, but the value is equivalent.
export async function embedTicket(
  ticket: { id: number; subject: string; body: string; embedding: number[] | null },
): Promise<number[] | null> {
  if (ticket.embedding && ticket.embedding.length > 0) {
    return ticket.embedding;
  }
  const text = buildTicketText(ticket);
  // single indexing choke point: unembedded tickets are never suggested (also gates support-kb-answer.ts)
  if (!hasEnoughSubstance(text)) return null;
  const [fresh] = await db
    .select({ embedding: supportTicketTable.embedding })
    .from(supportTicketTable)
    .where(eq(supportTicketTable.id, ticket.id))
    .limit(1);
  if (fresh?.embedding && fresh.embedding.length > 0) {
    return fresh.embedding;
  }
  const vec = await aiEmbed(text);
  if (!vec) return null;
  try {
    await db
      .update(supportTicketTable)
      .set({ embedding: vec, updated_at: new Date() })
      .where(eq(supportTicketTable.id, ticket.id));
  } catch (err) {
    console.error(
      "[support-ticket-embedding] failed to persist embedding",
      ticket.id,
      err,
    );
    return null;
  }
  return vec;
}

export interface SimilarTicket {
  id: number;
  subject: string;
  similarity: number;
  // the only target the receiving student can actually open
  url: string;
  // null when the thread resolved without a public answer
  answer: string | null;
}

// long enough to carry the fix, short enough not to bury the thread
const ANSWER_SNIPPET_CAP = 180;

// Bot rows are excluded so one bad answer can't compound by being quoted back.
// Quotes come from public threads only, so they're already readable by the viewer.
async function fetchAnswerSnippets(
  ticketIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (ticketIds.length === 0) return out;
  const idList = sql.join(
    ticketIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{ ticket_id: number | string; body: string }>(sql`
    SELECT DISTINCT ON (m.ticket_id) m.ticket_id, m.body
    FROM support_ticket_messages m
    JOIN support_tickets t ON t.id = m.ticket_id
    WHERE m.ticket_id IN (${idList})
      AND m.is_internal_note = false
      AND m.deleted_at IS NULL
      AND m.author_kind IN ('user', 'slack_external')
      AND (m.author_user_id IS NULL OR m.author_user_id <> t.user_id)
      AND length(btrim(m.body)) > 0
    ORDER BY m.ticket_id, m.created_at DESC
  `);
  for (const r of ((Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows) ?? []) as Array<{
    ticket_id: number | string;
    body: string;
  }>) {
    const id = typeof r.ticket_id === "string" ? Number(r.ticket_id) : r.ticket_id;
    const flat = (r.body ?? "").replace(/\s+/g, " ").trim();
    if (flat.length === 0) continue;
    out.set(
      id,
      flat.length > ANSWER_SNIPPET_CAP
        ? `${flat.slice(0, ANSWER_SNIPPET_CAP).trimEnd()}...`
        : flat,
    );
  }
  return out;
}

interface FindSimilarOpts {
  excludeTicketId: number;
  limit?: number;
  minSimilarity?: number;
}

// Resolved only, so suggestions have answers; public Slack thread required, the only place a non-owner can read it.
export async function findSimilarTickets(
  embedding: number[],
  opts: FindSimilarOpts,
): Promise<SimilarTicket[]> {
  const limit = opts.limit ?? SIMILAR_TICKET_LIMIT;
  const minSim = opts.minSimilarity ?? SIMILAR_TICKET_MIN_SIMILARITY;
  const literal = vectorLiteral(embedding);
  // <=> is pgvector's cosine distance, so similarity = 1 - distance
  const rows = await db.execute<{
    id: number;
    subject: string;
    body: string;
    slack_channel_id: string | null;
    slack_thread_ts: string | null;
    similarity: number;
  }>(sql`
    SELECT
      id,
      subject,
      body,
      slack_channel_id,
      slack_thread_ts,
      1 - (embedding <=> ${sql.raw(`'${literal}'::vector`)}) AS similarity
    FROM support_tickets
    WHERE embedding IS NOT NULL
      AND status = 'resolved'
      AND slack_channel_id IS NOT NULL
      AND slack_thread_ts IS NOT NULL
      AND id <> ${opts.excludeTicketId}
    ORDER BY embedding <=> ${sql.raw(`'${literal}'::vector`)}
    LIMIT ${limit * 4}
  `);
  const filtered: SimilarTicket[] = [];
  for (const r of ((Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows) ?? []) as Array<{
    id: number | string;
    subject: string;
    body: string;
    slack_channel_id: string | null;
    slack_thread_ts: string | null;
    similarity: number | string;
  }>) {
    const sim = typeof r.similarity === "string" ? Number(r.similarity) : r.similarity;
    if (!Number.isFinite(sim) || sim < minSim) continue;
    // rows embedded before the substance gate are still in the corpus, so re-check on read
    if (!hasEnoughSubstance(`${r.subject}\n\n${r.body ?? ""}`)) continue;
    const url = slackThreadUrl(r.slack_channel_id, r.slack_thread_ts);
    if (!url) continue;
    filtered.push({
      id: typeof r.id === "string" ? Number(r.id) : r.id,
      subject: r.subject,
      similarity: sim,
      url,
      answer: null,
    });
    if (filtered.length >= limit) break;
  }

  const snippets = await fetchAnswerSnippets(filtered.map((s) => s.id));
  for (const s of filtered) s.answer = snippets.get(s.id) ?? null;
  return filtered;
}

// TicketThread.vue's renderer ignores backslash-escapes, so a user-controlled `]` could
// redirect the link to an attacker URL; removing the brackets is the only reliable fix.
function sanitizeMarkdownLabel(s: string): string {
  return s.replaceAll("[", "").replaceAll("]", "");
}

// a `|` or `>` in the label would break out of Slack's `<url|label>` and embed an attacker URL
function sanitizeSlackLinkLabel(s: string): string {
  return s.replaceAll("<", "").replaceAll(">", "").replaceAll("|", "");
}

// docs first: a FAQ entry is a maintained answer, a resolved thread is one conversation
function buildCapybaraBody(
  suggestions: SimilarTicket[],
  docs: DocsPointer[],
): string {
  const parts: string[] = [];
  if (docs.length > 0) {
    parts.push(
      "Hi! I'm Capybara. This looks like something the docs already answer:",
    );
    parts.push(
      docs
        .map((d) => `- [${sanitizeMarkdownLabel(d.title)}](${d.url})`)
        .join("\n"),
    );
  }
  if (suggestions.length > 0) {
    parts.push(
      docs.length > 0
        ? "Someone ran into something similar before, too:"
        : suggestions.length === 1
          ? "Hi! I'm Capybara. I found a previously-resolved ticket that looks similar to yours, maybe it has the answer you need:"
          : "Hi! I'm Capybara. I found a few previously-resolved tickets that look similar to yours, maybe one of them has the answer you need:",
    );
    // same line on purpose: TicketThread.vue closes the <ul> on any line not starting with "- "
    parts.push(
      suggestions
        .map((s) => {
          const link = `- [#${s.id}, ${sanitizeMarkdownLabel(s.subject)}](${s.url})`;
          return s.answer
            ? `${link} "${sanitizeMarkdownLabel(s.answer)}"`
            : link;
        })
        .join("\n"),
    );
  }
  parts.push(
    "If none of these answer your question, just keep this thread open and the team will get to it.",
  );
  return parts.join("\n\n");
}

function buildCapybaraSlackText(
  suggestions: SimilarTicket[],
  docs: DocsPointer[],
): string {
  const parts: string[] = [];
  if (docs.length > 0) {
    parts.push(":capybara: The docs already cover this, I think:");
    parts.push(
      docs
        .map((d) => `• <${d.url}|${sanitizeSlackLinkLabel(d.title)}>`)
        .join("\n"),
    );
  }
  if (suggestions.length > 0) {
    parts.push(
      docs.length > 0
        ? "Someone ran into something similar before, too:"
        : suggestions.length === 1
          ? ":capybara: I found a previously-resolved ticket that looks similar, maybe it has the answer:"
          : ":capybara: I found a few previously-resolved tickets that look similar, maybe one of these has the answer:",
    );
    parts.push(
      suggestions
        .map((s) => {
          const link = `• <${s.url}|#${s.id}, ${sanitizeSlackLinkLabel(s.subject)}>`;
          return s.answer
            ? `${link} "${sanitizeSlackLinkLabel(s.answer)}"`
            : link;
        })
        .join("\n"),
    );
  }
  return parts.join("\n");
}

// Slack failures don't roll back the DB insert; the web UI message is authoritative.
export async function postCapybaraReply(
  ticket: {
    id: number;
    slack_channel_id: string | null;
    slack_thread_ts: string | null;
    bts_message_ts: string | null;
  },
  suggestions: SimilarTicket[],
  docs: DocsPointer[] = [],
): Promise<void> {
  if (suggestions.length === 0 && docs.length === 0) return;
  const body = buildCapybaraBody(suggestions, docs);
  let messageId: number | null = null;
  try {
    const [inserted] = await db
      .insert(supportTicketMessageTable)
      .values({
        ticket_id: ticket.id,
        author_user_id: null,
        author_kind: "capybara",
        body,
        is_internal_note: false,
      })
      .returning({ id: supportTicketMessageTable.id });
    messageId = inserted?.id ?? null;
  } catch (err) {
    console.error(
      "[support-ticket-embedding] failed to insert capybara message",
      ticket.id,
      err,
    );
    return;
  }

  if (messageId != null) {
    void publishMessageAdded(ticket.id, messageId);
  }

  const slackText = buildCapybaraSlackText(suggestions, docs);
  if (ticket.slack_channel_id && ticket.slack_thread_ts) {
    void postPublicThreadReply({
      channel: ticket.slack_channel_id,
      thread_ts: ticket.slack_thread_ts,
      text: slackText,
      username: CAPYBARA_USERNAME,
      icon_url: undefined, // falls back to Slack's default bot avatar
      // every line is a link, so unfurls would bury the question in preview cards
      unfurl_links: false,
      unfurl_media: false,
    });
  }
}

export async function ensureTicketEmbedded(ticketId: number): Promise<void> {
  try {
    const [row] = await db
      .select({
        id: supportTicketTable.id,
        subject: supportTicketTable.subject,
        body: supportTicketTable.body,
        embedding: supportTicketTable.embedding,
      })
      .from(supportTicketTable)
      .where(eq(supportTicketTable.id, ticketId))
      .limit(1);
    if (!row) return;
    if (row.embedding && row.embedding.length > 0) return;
    await embedTicket(row);
  } catch (err) {
    console.error(
      "[support-ticket-embedding] ensure embed failed",
      ticketId,
      err,
    );
  }
}

export async function runCapybaraForNewTicket(ticketId: number): Promise<void> {
  try {
    const [ticket] = await db
      .select({
        id: supportTicketTable.id,
        subject: supportTicketTable.subject,
        body: supportTicketTable.body,
        embedding: supportTicketTable.embedding,
        slack_channel_id: supportTicketTable.slack_channel_id,
        slack_thread_ts: supportTicketTable.slack_thread_ts,
        bts_message_ts: supportTicketTable.bts_message_ts,
      })
      .from(supportTicketTable)
      .where(eq(supportTicketTable.id, ticketId))
      .limit(1);
    if (!ticket) return;

    // the docs half needs no embedding, so gate here too or a "bump" gets FAQ links
    if (!hasEnoughSubstance(buildTicketText(ticket))) return;

    // independent, so a failed embedding doesn't also cost the docs link
    const [docs, embedding] = await Promise.all([
      findDocsPointers({ subject: ticket.subject, body: ticket.body }),
      embedTicket({
        id: ticket.id,
        subject: ticket.subject,
        body: ticket.body,
        embedding: ticket.embedding,
      }),
    ]);

    const suggestions = embedding
      ? await findSimilarTickets(embedding, { excludeTicketId: ticket.id })
      : [];
    if (suggestions.length === 0 && docs.length === 0) return;

    // re-read so bts_message_ts reflects the BTS post that ran in parallel
    const [fresh] = await db
      .select({
        slack_channel_id: supportTicketTable.slack_channel_id,
        slack_thread_ts: supportTicketTable.slack_thread_ts,
        bts_message_ts: supportTicketTable.bts_message_ts,
      })
      .from(supportTicketTable)
      .where(eq(supportTicketTable.id, ticketId))
      .limit(1);

    await postCapybaraReply(
      {
        id: ticket.id,
        slack_channel_id: fresh?.slack_channel_id ?? ticket.slack_channel_id,
        slack_thread_ts: fresh?.slack_thread_ts ?? ticket.slack_thread_ts,
        bts_message_ts: fresh?.bts_message_ts ?? ticket.bts_message_ts,
      },
      suggestions,
      docs,
    );
  } catch (err) {
    console.error(
      "[support-ticket-embedding] capybara run failed",
      ticketId,
      err,
    );
  }
}
