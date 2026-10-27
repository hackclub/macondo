// Finer-grained and manual compared to group_tag (shop-request-tag.ts). Safe to rerun: every cluster_id is overwritten.

import { eq, isNull } from "drizzle-orm";

import db from "../db";
import { shopItemRequestTable } from "../db/schema";
import { aiChat, getDefaultAiModel, QWEN_FALLBACK_MODEL, type ChatCompletionResponse } from "./hackclub-ai";

interface ClusterAssignment {
  cluster_id: number;
  request_ids: number[];
}

export async function clusterShopRequests(): Promise<{
  scanned: number;
  clustered: number;
}> {
  const open = (
    await db
      .select({
        id: shopItemRequestTable.id,
        name: shopItemRequestTable.name,
        description: shopItemRequestTable.description,
      })
      .from(shopItemRequestTable)
      .where(isNull(shopItemRequestTable.dismissed_at))
  ).filter((r) => r);
  if (open.length === 0) {
    return { scanned: 0, clustered: 0 };
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) {
    // No-op so the admin button doesn't throw; the browse page still groups by group_tag.
    return { scanned: open.length, clustered: 0 };
  }

  const systemPrompt =
    "You cluster shop-item requests by what physical product they describe. " +
    "Near-duplicates (same item, slightly different wording, e.g. \"mechanical keyboard\" and \"mech kb\") belong in the same cluster. " +
    "Return STRICT JSON ONLY in the shape: " +
    "{\"clusters\": [{\"cluster_id\": 1, \"request_ids\": [3, 7]}, ...]} " +
    "Every request id MUST appear in exactly one cluster. cluster_id is a positive integer. " +
    "Do not include prose, markdown, or explanation.";

  const userMessage =
    "Requests:\n" +
    open
      .map(
        (r) =>
          `#${r.id} ${r.name}${r.description ? " — " + r.description.slice(0, 200) : ""}`,
      )
      .join("\n");

  let rawContent = "";
  try {
    rawContent =
      (
        await aiChat<ChatCompletionResponse>({
          apiKey: aiKey,
          model: getDefaultAiModel(),
          fallbackModel: QWEN_FALLBACK_MODEL,
          timeout: 25_000, // batch calls can take longer than one-shot tagging
          body: {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            max_tokens: 1200,
            temperature: 0,
          },
        })
      )?.choices?.[0]?.message?.content ?? "";
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: "AI clustering request failed",
    });
  }

  let parsed: { clusters?: ClusterAssignment[] } | null = null;
  try {
    parsed = JSON.parse(rawContent.replace(/```json|```/g, "").trim());
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: "AI returned invalid JSON",
    });
  }

  const validIds = new Set(open.map((r) => r.id));
  let updated = 0;

  for (const c of Array.isArray(parsed?.clusters) ? parsed!.clusters : []) {
    if (
      !c ||
      typeof c.cluster_id !== "number" ||
      !Number.isFinite(c.cluster_id) ||
      !Array.isArray(c.request_ids)
    ) {
      continue;
    }
    for (const rid of c.request_ids) {
      if (typeof rid !== "number" || !validIds.has(rid)) continue;
      await db
        .update(shopItemRequestTable)
        .set({ cluster_id: c.cluster_id })
        .where(eq(shopItemRequestTable.id, rid));
      updated++;
    }
  }

  return { scanned: open.length, clustered: updated };
}
