import { eq } from "drizzle-orm";

import db from "../../../db";
import { internalOAuthConnectionTable, users } from "../../../db/schema";

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const hcbApi = typeof config.hcbApi === "string" ? config.hcbApi.trim() : "";
  const hcbOauthSecret =
    typeof config.hcbOauthSecret === "string" && config.hcbOauthSecret.trim().length > 0
      ? config.hcbOauthSecret.trim()
      : hcbApi.startsWith("hcb_")
        ? ""
        : hcbApi;
  const [connection] = await db
    .select({
      id: internalOAuthConnectionTable.id,
      token_type: internalOAuthConnectionTable.token_type,
      scope: internalOAuthConnectionTable.scope,
      expires_at: internalOAuthConnectionTable.expires_at,
      external_user_id: internalOAuthConnectionTable.external_user_id,
      external_user_email: internalOAuthConnectionTable.external_user_email,
      created_at: internalOAuthConnectionTable.created_at,
      updated_at: internalOAuthConnectionTable.updated_at,
      connectedBy: {
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      },
    })
    .from(internalOAuthConnectionTable)
    .leftJoin(users, eq(internalOAuthConnectionTable.connected_by_user_id, users.id))
    .where(eq(internalOAuthConnectionTable.provider, "hcb_grants"))
    .limit(1);

  const expiresAt = connection?.expires_at?.toISOString() ?? null;

  return {
    connected: !!connection,
    source: connection ? "oauth" : null,
    hcbOrganizationIdConfigured:
      typeof config.hcbOrganizationId === "string" && config.hcbOrganizationId.trim().length > 0,
    directApiTokenConfigured:
      (typeof config.hcbApiToken === "string" && config.hcbApiToken.trim().length > 0) ||
      hcbApi.startsWith("hcb_"),
    oauthClientConfigured:
      typeof config.hcbOauthUid === "string" &&
      config.hcbOauthUid.trim().length > 0 &&
      hcbOauthSecret.length > 0,
    connection: connection
      ? {
          id: connection.id,
          tokenType: connection.token_type,
          scope: connection.scope,
          expiresAt,
          isExpired: connection.expires_at
            ? connection.expires_at.getTime() <= Date.now()
            : false,
          externalUserId: connection.external_user_id,
          externalUserEmail: connection.external_user_email,
          connectedBy: connection.connectedBy?.id ? connection.connectedBy : null,
          createdAt: connection.created_at?.toISOString() ?? null,
          updatedAt: connection.updated_at?.toISOString() ?? null,
        }
      : null,
  };
});
