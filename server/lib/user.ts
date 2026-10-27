import { and, eq } from "drizzle-orm";

import db from "../db";
import { shadowBanTable } from "../db/schema";

export async function isShadowBanned(userId: string): Promise<boolean> {
  const [activeShadowBan] = await db
    .select({ id: shadowBanTable.id })
    .from(shadowBanTable)
    .where(
      and(
        eq(shadowBanTable.user_id, userId),
        eq(shadowBanTable.active, true),
      ),
    )
    .limit(1);

  return activeShadowBan != null;
}

// for non-staff surfaces: never fall back to the legal name, which is internal-only
export function getDisplayName(user: {
  username?: string | null;
  email?: string | null;
}): string {
  const username = user.username?.trim();
  if (username) return username;
  const email = user.email?.trim();
  if (email) {
    const local = email.split("@")[0];
    if (local) return local;
  }
  return "a user";
}
