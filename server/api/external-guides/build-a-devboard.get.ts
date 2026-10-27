import {
  KAI_AUTHOR_NAME,
  KAI_AUTHOR_URL,
  KAI_DEVBOARD_CANONICAL,
  fetchKaiDevboardSource,
  translateKaiDevboard,
} from "../../lib/external-guides";

export default defineEventHandler(async (event) => {
  const locale = getQuery(event).locale === "es" ? "es" : "en";

  try {
    const { markdown: source, sourceHash } = await fetchKaiDevboardSource();
    return {
      markdown:
        locale === "es"
          ? await translateKaiDevboard(source, sourceHash, "es")
          : source,
      sourceHash,
      locale,
      canonical: KAI_DEVBOARD_CANONICAL,
      author: { name: KAI_AUTHOR_NAME, url: KAI_AUTHOR_URL },
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.error("[external-guides] Failed to load Kai devboard guide", err);
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to load external guide",
      data: {
        canonical: KAI_DEVBOARD_CANONICAL,
        author: { name: KAI_AUTHOR_NAME, url: KAI_AUTHOR_URL },
        fallback: true,
      },
    });
  }
});
