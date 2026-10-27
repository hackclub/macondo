import sharp from "sharp";
import { safeBufferRequest, validateOutboundUrl } from "../../lib/outbound-url";

// Satori can't embed WebP and hc-cdn serves WebP, so OG cards get PNGs from here.
// The host allowlist prevents SSRF; failures return a transparent pixel so the card still renders.

// Project thumbnails (hc-cdn) plus Slack or Gravatar avatars.
function isAllowedHost(host: string): boolean {
  return (
    host === "cdn.hackclub.com" ||
    host === "secure.gravatar.com" ||
    host === "slack-edge.com" ||
    host.endsWith(".slack-edge.com")
  );
}

async function transparentPixel(): Promise<Buffer> {
  return sharp({
    create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
}

export default defineEventHandler(async (event) => {
  const raw = getQuery(event).u;
  if (!raw || typeof raw !== "string") {
    throw createError({ statusCode: 400, statusMessage: "Missing image url" });
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw createError({ statusCode: 400, statusMessage: "Invalid image url" });
  }
  if (url.protocol !== "https:" || !isAllowedHost(url.hostname)) {
    throw createError({ statusCode: 400, statusMessage: "Image host not allowed" });
  }

  let current = url;
  try {
    // Manual redirects: each hop is re-validated against the host allowlist,
    // so a redirect on an allowed host can't walk the fetch to an arbitrary server.
    let bytes: Buffer | null = null;
    for (let hop = 0; hop < 3; hop++) {
      if (validateOutboundUrl(current)) throw new Error("image URL not allowed");
      const res = await safeBufferRequest(current, { maxBytes: 5 * 1024 * 1024 });
      if (res.truncated) throw new Error("image too large");
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.location;
        if (!location) throw new Error("redirect without location");
        const next = new URL(location, current);
        if (next.protocol !== "https:" || !isAllowedHost(next.hostname)) {
          throw new Error("redirect host not allowed");
        }
        current = next;
        continue;
      }
      if (res.status < 200 || res.status >= 300) throw new Error(`upstream ${res.status}`);
      bytes = res.body;
      break;
    }
    if (!bytes) throw new Error("too many redirects");
    const png = await sharp(bytes, { limitInputPixels: 16_000_000 })
      .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    setHeader(event, "content-type", "image/png");
    setHeader(event, "cache-control", "public, max-age=86400, s-maxage=86400");
    return png;
  } catch {
    setHeader(event, "content-type", "image/png");
    setHeader(event, "cache-control", "public, max-age=300");
    return transparentPixel();
  }
});
