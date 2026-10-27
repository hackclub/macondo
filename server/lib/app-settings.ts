import { eq } from "drizzle-orm";
import db from "../db";
import { appSettingsTable } from "../db/schema";

const SHOP_UNDER_RENOVATION_KEY = "shop_under_renovation";

export async function isShopUnderRenovation(): Promise<boolean> {
  return (
    await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, SHOP_UNDER_RENOVATION_KEY))
      .limit(1)
  )[0]?.value === true;
}

export async function setShopUnderRenovation(value: boolean, userId: string) {
  const now = new Date();
  await db
    .insert(appSettingsTable)
    .values({
      key: SHOP_UNDER_RENOVATION_KEY,
      value,
      updated_at: now,
      updated_by: userId,
    })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updated_at: now, updated_by: userId },
    });
}

const MUSIC_ENABLED_KEY = "music_enabled";

export async function isMusicEnabled(): Promise<boolean> {
  return (
    await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, MUSIC_ENABLED_KEY))
      .limit(1)
  )[0]?.value === true;
}

export async function setMusicEnabled(value: boolean, userId: string) {
  const now = new Date();
  await db
    .insert(appSettingsTable)
    .values({
      key: MUSIC_ENABLED_KEY,
      value,
      updated_at: now,
      updated_by: userId,
    })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value, updated_at: now, updated_by: userId },
    });
}

const ARI_ENABLED_KEY = "ari_enabled";
const ARI_AUTHORITATIVE_KEY = "ari_authoritative";

// When true, new ships are also pushed to ARI and its decisions recorded as advisory state.
export async function isAriEnabled(): Promise<boolean> {
  return (
    await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, ARI_ENABLED_KEY))
      .limit(1)
  )[0]?.value === true;
}

// Inbound ARI decisions drive the ship lifecycle; only meaningful while ari_enabled is also true.
export async function isAriAuthoritative(): Promise<boolean> {
  return (
    await db
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, ARI_AUTHORITATIVE_KEY))
      .limit(1)
  )[0]?.value === true;
}
