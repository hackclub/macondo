// Rendered HTML is no-cache so proxies can't serve a stale shell pointing at a previous
// deploy's deleted /_nuxt chunks. Hashed assets bypass this hook and keep their max-age.

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:response", (response) => {
    const headers = (response.headers ?? {}) as Record<string, string>;

    // explicit swr/cache route rules win over this default
    if (Object.keys(headers).some((k) => k.toLowerCase() === "cache-control")) return;

    headers["cache-control"] = "no-cache";
    response.headers = headers;
  });
});
