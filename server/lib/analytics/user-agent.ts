// no dependency on purpose: ua-parser-js v2 is AGPL/commercial and we only need coarse buckets

export type ParsedUserAgent = {
  browser: string | null;
  os: string | null;
  deviceType: "desktop" | "mobile" | "tablet" | null;
};

// empty UAs count as bots too; "bot" already catches Googlebot, so no bare "google" rule
// that would misfire on Android webviews
const BOT_PATTERN =
  /bot\b|bot\/|crawl|spider|slurp|crawler|facebookexternalhit|slackbot|telegram|whatsapp|discord|embedly|bingpreview|duckduckbot|baiduspider|yandex|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|curl|wget|python-requests|python-urllib|go-http|okhttp|axios|node-fetch|headless|phantom|puppeteer|playwright|lighthouse|pingdom|uptimerobot|statuscake|gtmetrix|monitor/i;

export function isBot(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_PATTERN.test(ua);
}

function detectBrowser(ua: string): string | null {
  // order matters: each later token also appears in the earlier browsers' UAs
  if (/Edg(?:A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return null;
}

function detectOs(ua: string): string | null {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/CrOS/.test(ua)) return "Chrome OS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function detectDeviceType(ua: string): "desktop" | "mobile" | "tablet" | null {
  // modern iPadOS sends a desktop Safari UA but still carries "iPad"
  if (/iPad/.test(ua)) return "tablet";
  // Android tablets omit "Mobile"
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "mobile" : "tablet";
  if (/iPhone|iPod/.test(ua)) return "mobile";
  if (/Mobile/.test(ua)) return "mobile";
  return "desktop";
}

export function parseUserAgent(
  ua: string | null | undefined,
): ParsedUserAgent {
  if (!ua || !ua.trim()) {
    return { browser: null, os: null, deviceType: null };
  }
  return {
    browser: detectBrowser(ua),
    os: detectOs(ua),
    deviceType: detectDeviceType(ua),
  };
}

// width is the CSS-pixel innerWidth sent by app/plugins/analytics.client.ts
export function bucketScreenSize(width: number | null | undefined): string | null {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  if (width < 576) return "Mobile"; // bootstrap-style breakpoints in px
  if (width < 992) return "Tablet";
  if (width < 1440) return "Laptop";
  return "Desktop";
}
