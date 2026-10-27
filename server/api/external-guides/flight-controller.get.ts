import {
  FLIGHT_CONTROLLER_AUTHOR_NAME,
  FLIGHT_CONTROLLER_AUTHOR_URL,
  FLIGHT_CONTROLLER_CANONICAL,
  fetchFlightControllerSource,
  translateFlightController,
} from "../../lib/external-guides";

export default defineEventHandler(async (event) => {
  const locale = getQuery(event).locale === "es" ? "es" : "en";

  try {
    const { markdown: source, sourceHash } = await fetchFlightControllerSource();
    return {
      markdown:
        locale === "es"
          ? await translateFlightController(source, sourceHash, "es")
          : source,
      sourceHash,
      locale,
      canonical: FLIGHT_CONTROLLER_CANONICAL,
      author: { name: FLIGHT_CONTROLLER_AUTHOR_NAME, url: FLIGHT_CONTROLLER_AUTHOR_URL },
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.error("[external-guides] Failed to load flight controller guide", err);
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to load external guide",
      data: {
        canonical: FLIGHT_CONTROLLER_CANONICAL,
        author: { name: FLIGHT_CONTROLLER_AUTHOR_NAME, url: FLIGHT_CONTROLLER_AUTHOR_URL },
        fallback: true,
      },
    });
  }
});
