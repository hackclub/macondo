import { sql } from "drizzle-orm";
import db from "../../db";

// Shadow bans record fraud (including Hackatime flags), so shadow-banned users don't count.
// All metrics are cumulative and TZ-agnostic; a per-day metric would need a one-day delayed window.

const VALID_TYPES = new Set(["upvotes", "hours", "ships", "gold", "referrals"]);

function pickString(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function clampLimit(raw: unknown): number {
    const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : NaN;
    if (!Number.isFinite(n) || n <= 0) return 25;
    return Math.min(Math.floor(n), 100);
}

export default defineEventHandler(async (event) => {
    const q = getQuery(event);
    const typeRaw = pickString(q.type) ?? "upvotes";
    const type = VALID_TYPES.has(typeRaw) ? typeRaw : "upvotes";
    const limit = clampLimit(q.limit);

    // sub (the OAuth identity) is more reliable than hca_verification_status, which is null for legacy users.
    const baseWhere = sql`
        u.sub IS NOT NULL
        AND u.is_temp = false
        AND u.is_system = false
        AND u.onboarding_step IS DISTINCT FROM 'welcome'
        AND NOT EXISTS (
            SELECT 1 FROM shadow_bans sb
            WHERE sb.user_id = u.id AND sb.active = true
        )
    `;

    let query;
    if (type === "upvotes") {
        query = sql`
            SELECT
                u.id,
                u.username,
                u.image,
                u.slack_id,
                u.created_at,
                COALESCE(stats.total, 0)::numeric AS metric,
                COALESCE(stats.project_count, 0)::int AS project_count
            FROM users u
            LEFT JOIN (
                SELECT
                    p.user_id,
                    SUM(uv.cnt) AS total,
                    COUNT(DISTINCT p.id) AS project_count
                FROM projects p
                LEFT JOIN (
                    SELECT project_id, COUNT(*) AS cnt
                    FROM project_upvotes
                    GROUP BY project_id
                ) uv ON uv.project_id = p.id
                WHERE p.deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1 FROM journals j WHERE j.project_id = p.id AND j.archived = false
                )
                GROUP BY p.user_id
            ) stats ON stats.user_id = u.id
            WHERE ${baseWhere}
            ORDER BY metric DESC NULLS LAST, u.id ASC
            LIMIT ${limit}
        `;
    } else if (type === "hours") {
        query = sql`
            SELECT
                u.id,
                u.username,
                u.image,
                u.slack_id,
                u.created_at,
                COALESCE(c.total_hours, 0)::numeric AS metric,
                0::int AS project_count
            FROM users u
            LEFT JOIN (
                SELECT sc.user_id, SUM(COALESCE(sc.approved_hours, 0)) AS total_hours
                FROM ship_contributors sc
                JOIN ships s ON s.id = sc.ship_id
                WHERE s.status IN ('shipped', 'shipped_missing_airtable')
                GROUP BY sc.user_id
            ) c ON c.user_id = u.id
            WHERE ${baseWhere}
            ORDER BY metric DESC NULLS LAST, u.id ASC
            LIMIT ${limit}
        `;
    } else if (type === "ships") {
        query = sql`
            SELECT
                u.id,
                u.username,
                u.image,
                u.slack_id,
                u.created_at,
                COALESCE(s.cnt, 0)::numeric AS metric,
                0::int AS project_count
            FROM users u
            LEFT JOIN (
                SELECT user_id, COUNT(*) AS cnt
                FROM ships
                WHERE status IN ('shipped', 'shipped_missing_airtable')
                GROUP BY user_id
            ) s ON s.user_id = u.id
            WHERE ${baseWhere}
            ORDER BY metric DESC NULLS LAST, u.id ASC
            LIMIT ${limit}
        `;
    } else if (type === "gold") {
        query = sql`
            SELECT
                u.id,
                u.username,
                u.image,
                u.slack_id,
                u.created_at,
                COALESCE(g.balance, 0)::numeric AS metric,
                0::int AS project_count
            FROM users u
            LEFT JOIN (
                SELECT
                    user_id,
                    SUM(CASE WHEN type = 'increase' THEN amount ELSE -amount END) AS balance
                FROM currency_transactions
                WHERE fruit_type IS NULL
                  AND counts = true
                GROUP BY user_id
            ) g ON g.user_id = u.id
            WHERE ${baseWhere}
            ORDER BY metric DESC NULLS LAST, u.id ASC
            LIMIT ${limit}
        `;
    } else {
        query = sql`
            SELECT
                u.id,
                u.username,
                u.image,
                u.slack_id,
                u.created_at,
                COALESCE(r.cnt, 0)::numeric AS metric,
                0::int AS project_count
            FROM users u
            LEFT JOIN (
                SELECT
                    referred_by_user_id AS referrer_id,
                    COUNT(*) AS cnt
                FROM users
                WHERE referred_by_user_id IS NOT NULL
                  AND is_temp = false
                  AND onboarding_step IS DISTINCT FROM 'welcome'
                  AND sub IS NOT NULL
                  AND hca_verification_status = 'verified'
                GROUP BY referred_by_user_id
            ) r ON r.referrer_id = u.id
            WHERE ${baseWhere}
            ORDER BY metric DESC NULLS LAST, u.id ASC
            LIMIT ${limit}
        `;
    }

    const rows = await db.execute<{
        id: string;
        username: string | null;
        image: string | null;
        slack_id: string | null;
        created_at: Date | null;
        metric: string | number;
        project_count: number;
    }>(query);

    // PII guard: never return legal name or country. Cumulative metrics tolerate a longer SWR window.
    setHeader(event, "Cache-Control", "public, max-age=60, s-maxage=120, stale-while-revalidate=600");
    return {
        type,
        items: rows.map((r, idx) => ({
            rank: idx + 1,
            id: r.id,
            username: r.username,
            image: r.image,
            slack_id: r.slack_id,
            created_at: r.created_at,
            metric: Number(r.metric ?? 0),
            project_count: Number(r.project_count ?? 0),
        })),
    };
});
