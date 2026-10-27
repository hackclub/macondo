import { eq } from "drizzle-orm";

import db from "../../../../db";
import { shopItemRequestTable } from "../../../../db/schema";
import { aiChat, getDefaultAiModel } from "../../../../lib/hackclub-ai";
import { canAccessInternalShopAdmin } from "../../../../policies/internal";

interface AiStore {
  store_name: string;
  likely_url: string;
  estimated_price_usd: number | null;
  notes?: string;
}

export default defineEventHandler(async (event) => {
  const actor = event.context.user;

  if (!actor || !canAccessInternalShopAdmin(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const id = Number(getRouterParam(event, "id"));
  if (!Number.isFinite(id) || id <= 0) {
    throw createError({ statusCode: 400, statusMessage: "Invalid id" });
  }

  const [request] = await db
    .select()
    .from(shopItemRequestTable)
    .where(eq(shopItemRequestTable.id, id))
    .limit(1);

  if (!request) {
    throw createError({ statusCode: 404, statusMessage: "Request not found" });
  }

  const config = useRuntimeConfig();
  const aiKey = config.hackclubAiKey as string | undefined;
  if (!aiKey) {
    throw createError({ statusCode: 503, statusMessage: "AI service not configured" });
  }

  const systemPrompt =
    "You are a product sourcing assistant for Hack Club's teen shop. " +
    "Given a product description, suggest 3-5 reputable online retailers that likely sell it, along with best-guess URL patterns and estimated USD prices based on typical retail. " +
    "Return STRICT JSON ONLY in the shape: " +
    "{\"stores\": [{\"store_name\": \"...\", \"likely_url\": \"https://...\", \"estimated_price_usd\": 29.99, \"notes\": \"optional short note\"}]} " +
    "The likely_url should be either a direct product search URL on the retailer's site, or the product category landing page. " +
    "estimated_price_usd may be null if unknown. " +
    "Do not include prose or markdown fences.";

  const userMessage =
    `Product: ${request.name}\n` +
    (request.description ? `Description: ${request.description}\n` : "") +
    (request.store_url ? `Reference link from requester: ${request.store_url}\n` : "") +
    "Suggest stores with URLs and estimated prices.";

  let rawContent = "";
  try {
    rawContent = (await aiChat<{ choices: { message: { content: string } }[] }>({
      apiKey: aiKey,
      model: getDefaultAiModel(),
      body: {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 800,
        temperature: 0.3,
      },
    }))?.choices?.[0]?.message?.content ?? "";
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: "AI pricing lookup failed",
    });
  }

  let parsed: { stores?: AiStore[] } | null = null;
  try {
    parsed = JSON.parse(rawContent.replace(/```json|```/g, "").trim());
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: "AI returned invalid JSON",
    });
  }

  const normalized = (Array.isArray(parsed?.stores) ? parsed!.stores : [])
    .filter((s) => s && typeof s.store_name === "string" && typeof s.likely_url === "string")
    .slice(0, 10)
    .map((s) => ({
      store_name: String(s.store_name).slice(0, 80), // truncate model output to sane lengths
      likely_url: String(s.likely_url).slice(0, 500),
      estimated_price_usd:
        typeof s.estimated_price_usd === "number" && Number.isFinite(s.estimated_price_usd)
          ? s.estimated_price_usd
          : null,
      notes: typeof s.notes === "string" ? s.notes.slice(0, 300) : undefined,
    }));

  const payload = {
    stores: normalized,
    fetched_at: new Date().toISOString(),
  };

  await db
    .update(shopItemRequestTable)
    .set({ pricing_info: payload })
    .where(eq(shopItemRequestTable.id, id));

  return { ok: true, pricing_info: payload };
});
