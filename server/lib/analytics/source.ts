// explicit utm_source wins, then the referrer host, otherwise Direct (like Plausible)

export const DIRECT_SOURCE = "Direct / None";

export type SourceInput = {
  refererHost?: string | null;
  utmSource?: string | null;
};

// utm_source is author-controlled, so normalize obvious variants; unknown values pass through
const UTM_ALIASES: Record<string, string> = {
  google: "Google",
  bing: "Bing",
  twitter: "Twitter",
  x: "Twitter",
  fb: "Facebook",
  facebook: "Facebook",
  ig: "Instagram",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  youtube: "YouTube",
  yt: "YouTube",
  github: "GitHub",
  newsletter: "Newsletter",
  email: "Email",
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
  hackclub: "Hack Club",
};

// search engines are matched by regex instead so regional TLDs collapse to one label
const HOST_NAMES: Record<string, string> = {
  "t.co": "Twitter",
  "twitter.com": "Twitter",
  "x.com": "Twitter",
  "facebook.com": "Facebook",
  "m.facebook.com": "Facebook",
  "l.facebook.com": "Facebook",
  "fb.com": "Facebook",
  "instagram.com": "Instagram",
  "l.instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "lnkd.in": "LinkedIn",
  "reddit.com": "Reddit",
  "out.reddit.com": "Reddit",
  "youtube.com": "YouTube",
  "m.youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "github.com": "GitHub",
  "news.ycombinator.com": "Hacker News",
  "discord.com": "Discord",
  "discordapp.com": "Discord",
  "discord.gg": "Discord",
  "t.me": "Telegram",
  "telegram.org": "Telegram",
};

function nameForHost(rawHost: string): string {
  const host = rawHost.toLowerCase();
  if (/(^|\.)google\./.test(host)) return "Google";
  if (/(^|\.)bing\./.test(host)) return "Bing";
  if (/(^|\.)duckduckgo\./.test(host)) return "DuckDuckGo";
  if (/(^|\.)yahoo\./.test(host)) return "Yahoo";
  if (/(^|\.)ecosia\./.test(host)) return "Ecosia";
  if (/(^|\.)yandex\./.test(host)) return "Yandex";
  if (/(^|\.)hackclub\.com$/.test(host)) return "Hack Club";
  const stripped = host.replace(/^www\./, "");
  return HOST_NAMES[stripped] ?? stripped;
}

export function classifySource(input: SourceInput): string {
  const utm = input.utmSource?.trim();
  if (utm) {
    return UTM_ALIASES[utm.toLowerCase()] ?? utm;
  }
  const host = input.refererHost?.trim();
  if (host) return nameForHost(host);
  return DIRECT_SOURCE;
}
