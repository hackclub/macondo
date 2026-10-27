import { and, count, eq, isNotNull, isNull, max, sql } from "drizzle-orm";

import db from "../db";
import {
  currencyTransactionTable,
  projectTable,
  userAchievementsTable,
  users,
} from "../db/schema";
import { computeDashboardStreak } from "./streaks";
import { notify } from "./notify";

export type AchievementMetric =
  | "streak"
  | "gold"
  | "projects"
  | "freezes"
  | "stage"
  | "unlocked_count";
export type AchievementCategory = "streak" | "gold" | "projects" | "secret";

export interface AchievementDef {
  key: string;
  category: AchievementCategory;
  metric: AchievementMetric;
  threshold: number;
  icon: string;
  secret: boolean;
}

// Mirrors the MacondoPlus extension's catalog. Display strings live in i18n under achievements.items.<key>.
export const ACHIEVEMENTS: AchievementDef[] = [
  { key: "on-fire", category: "streak", metric: "streak", threshold: 5, icon: "Flame", secret: false },
  { key: "ablaze", category: "streak", metric: "streak", threshold: 10, icon: "Flame", secret: false },
  { key: "raging", category: "streak", metric: "streak", threshold: 15, icon: "Flame", secret: false },
  { key: "inferno", category: "streak", metric: "streak", threshold: 30, icon: "Flame", secret: false },
  { key: "unstoppable", category: "streak", metric: "streak", threshold: 50, icon: "Flame", secret: false },
  { key: "legendary", category: "streak", metric: "streak", threshold: 75, icon: "Flame", secret: false },
  { key: "first-gold", category: "gold", metric: "gold", threshold: 1, icon: "Coins", secret: false },
  { key: "gilded", category: "gold", metric: "gold", threshold: 500, icon: "Coins", secret: false },
  { key: "hoarder", category: "gold", metric: "gold", threshold: 1500, icon: "Coins", secret: false },
  { key: "mr-krabs", category: "gold", metric: "gold", threshold: 3000, icon: "Coins", secret: false },
  { key: "bank-of-macondo", category: "gold", metric: "gold", threshold: 5000, icon: "Coins", secret: false },
  { key: "planted", category: "projects", metric: "projects", threshold: 1, icon: "Sprout", secret: false },
  { key: "growing", category: "projects", metric: "projects", threshold: 3, icon: "Leaf", secret: false },
  { key: "forest", category: "projects", metric: "projects", threshold: 5, icon: "TreePine", secret: false },
  { key: "prepared", category: "secret", metric: "freezes", threshold: 6, icon: "Snowflake", secret: true },
  { key: "professional", category: "secret", metric: "stage", threshold: 3, icon: "Award", secret: true },
  { key: "perfectionist", category: "secret", metric: "unlocked_count", threshold: 15, icon: "Crown", secret: true },
];

export interface AchievementStats {
  streak: number;
  gold: number;
  projects: number;
  freezes: number;
  maxStage: number;
}

export async function getUserAchievementStats(
  userId: string,
  timezone: string | null | undefined,
): Promise<AchievementStats> {
  const [streak, gold, projects, freezes, maxStage] = await Promise.all([
    // Same headline streak the dashboard shows, not the bare streak_days run, so the numbers never disagree.
    computeDashboardStreak(userId, timezone),
    db
      .select({
        balance: sql<number>`COALESCE(SUM(CASE WHEN ${currencyTransactionTable.type} = 'increase' THEN ${currencyTransactionTable.amount} ELSE -${currencyTransactionTable.amount} END), 0)`.mapWith(
          Number,
        ),
      })
      .from(currencyTransactionTable)
      .where(
        and(
          eq(currencyTransactionTable.user_id, userId),
          eq(currencyTransactionTable.counts, true),
          isNull(currencyTransactionTable.fruit_type),
          isNotNull(currencyTransactionTable.unlocked_at),
        ),
      )
      .then((r) => r[0]?.balance ?? 0),
    db
      .select({ c: count() })
      .from(projectTable)
      .where(eq(projectTable.user_id, userId))
      .then((r) => r[0]?.c ?? 0),
    db
      .select({ f: users.streak_freezes_remaining })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((r) => r[0]?.f ?? 0),
    db
      .select({ s: max(projectTable.stage) })
      .from(projectTable)
      .where(eq(projectTable.user_id, userId))
      .then((r) => r[0]?.s ?? 0),
  ]);
  return { streak, gold, projects, freezes, maxStage };
}

function metricValue(stats: AchievementStats, metric: AchievementMetric): number {
  switch (metric) {
    case "streak":
      return stats.streak;
    case "gold":
      return stats.gold;
    case "projects":
      return stats.projects;
    case "freezes":
      return stats.freezes;
    case "stage":
      return stats.maxStage;
    case "unlocked_count":
      return 0;
  }
}

export interface AchievementState extends AchievementDef {
  unlocked: boolean;
  unlocked_at: string | null;
  value: number;
}

// Tolerates a missing user_achievements table: live progress still renders, just without persistence.
export async function evaluateAchievements(
  userId: string,
  timezone: string | null | undefined,
): Promise<{ stats: AchievementStats; states: AchievementState[] }> {
  const stats = await getUserAchievementStats(userId, timezone);

  const unlockedAt = new Map<string, Date>();
  try {
    for (const r of await db
      .select({
        key: userAchievementsTable.achievement_key,
        unlocked_at: userAchievementsTable.unlocked_at,
      })
      .from(userAchievementsTable)
      .where(eq(userAchievementsTable.user_id, userId))) {
      unlockedAt.set(r.key, r.unlocked_at);
    }
  } catch (err) {
    console.error("[achievements] could not read user_achievements", err);
  }

  // Once persisted, an achievement stays unlocked even if the live stat drops.
  const valueByKey = new Map<string, number>();
  const metByKey = new Map<string, boolean>();
  for (const def of ACHIEVEMENTS) {
    if (def.metric === "unlocked_count") continue;
    const v = metricValue(stats, def.metric);
    valueByKey.set(def.key, v);
    metByKey.set(def.key, unlockedAt.has(def.key) || v >= def.threshold);
  }

  const baseUnlocked = ACHIEVEMENTS.filter(
    (d) => d.metric !== "unlocked_count" && metByKey.get(d.key),
  ).length;
  for (const def of ACHIEVEMENTS) {
    if (def.metric !== "unlocked_count") continue;
    valueByKey.set(def.key, baseUnlocked);
    metByKey.set(def.key, unlockedAt.has(def.key) || baseUnlocked >= def.threshold);
  }

  const newlyUnlocked = ACHIEVEMENTS.filter(
    (d) => metByKey.get(d.key) && !unlockedAt.has(d.key),
  );

  if (newlyUnlocked.length > 0) {
    try {
      const now = new Date();
      await db
        .insert(userAchievementsTable)
        .values(
          newlyUnlocked.map((d) => ({
            user_id: userId,
            achievement_key: d.key,
            unlocked_at: now,
          })),
        )
        .onConflictDoNothing();
      for (const d of newlyUnlocked) {
        unlockedAt.set(d.key, now);
        // notify never throws
        void notify({
          user_id: userId,
          type: "achievement_unlocked",
          title: "Achievement unlocked!",
          body: "You earned a new achievement. Open your achievements to see it.",
          action_url: "/achievements",
          entity_type: "achievement",
          entity_id: d.key,
        });
      }
    } catch (err) {
      console.error("[achievements] could not persist unlocks", err);
    }
  }

  return {
    stats,
    states: ACHIEVEMENTS.map((def): AchievementState => {
      const at = unlockedAt.get(def.key) ?? null;
      return {
        ...def,
        unlocked: at != null || (metByKey.get(def.key) ?? false),
        unlocked_at: at ? at.toISOString() : null,
        value: valueByKey.get(def.key) ?? 0,
      };
    }),
  };
}
