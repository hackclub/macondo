import { and, gt, inArray } from "drizzle-orm";
import db from "../../db";
import { analyticsPageviewsTable, sessions } from "../../db/schema";
import { hashSessionToken } from "../session";

// buffered in-process and bulk-flushed to keep the beacon hot path cheap (mirrors
// flushReferralVisits); views buffered at process exit are dropped, which is acceptable

export type PendingPageview = {
  sessionToken: string | null;
  visitor_id: string;
  pathname: string;
  referrer_host: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  country: string | null;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  screen_size: string | null;
};

const pending: PendingPageview[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function enqueuePageview(view: PendingPageview): void {
  pending.push(view);
  if (pending.length >= 500) { // max buffered pageviews before flushing
    void flushPageviews();
    return;
  }
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushPageviews();
    }, 5_000);
  }
}

export async function flushPageviews(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  try {
    const tokens = [
      ...new Set(
        batch
          .map((v) => v.sessionToken)
          .filter((t): t is string => typeof t === "string" && t.length > 0),
      ),
    ];
    const tokenToUserId = new Map<string, string>();
    if (tokens.length > 0) {
      // Tokens are stored hashed at rest, so both the raw cookie value (legacy
      // plaintext rows) and its SHA-256 are matched.
      const hashed = tokens.map((t) => hashSessionToken(t));
      const rows = await db
        .select({ token: sessions.token, userId: sessions.userId })
        .from(sessions)
        .where(
          and(
            inArray(sessions.token, [...tokens, ...hashed]),
            gt(sessions.expiresAt, new Date()),
          ),
        );
      const hashToRaw = new Map(hashed.map((h, i) => [h, tokens[i]!]));
      for (const r of rows) {
        tokenToUserId.set(r.token, r.userId); // legacy plaintext row
        const raw = hashToRaw.get(r.token);
        if (raw) tokenToUserId.set(raw, r.userId); // hashed row
      }
    }
    await db.insert(analyticsPageviewsTable).values(
      batch.map((v) => ({
        visitor_id: v.visitor_id,
        user_id: v.sessionToken
          ? tokenToUserId.get(v.sessionToken) ?? null
          : null,
        pathname: v.pathname,
        referrer_host: v.referrer_host,
        source: v.source,
        utm_source: v.utm_source,
        utm_medium: v.utm_medium,
        utm_campaign: v.utm_campaign,
        utm_term: v.utm_term,
        utm_content: v.utm_content,
        country: v.country,
        browser: v.browser,
        os: v.os,
        device_type: v.device_type,
        screen_size: v.screen_size,
      })),
    );
  } catch (err) {
    console.error("[analytics] bulk insert failed", err);
  }
}
