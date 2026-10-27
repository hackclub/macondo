import { describe, expect, test } from "bun:test";

import { classifySource, DIRECT_SOURCE } from "./source";

describe("classifySource", () => {
  test("no referrer and no utm is Direct", () => {
    expect(classifySource({})).toBe(DIRECT_SOURCE);
    expect(classifySource({ refererHost: null, utmSource: null })).toBe(
      DIRECT_SOURCE,
    );
    expect(classifySource({ refererHost: "  ", utmSource: "" })).toBe(
      DIRECT_SOURCE,
    );
  });

  test("utm_source wins over referrer", () => {
    expect(
      classifySource({ refererHost: "google.com", utmSource: "newsletter" }),
    ).toBe("Newsletter");
  });

  test("utm aliases normalize", () => {
    expect(classifySource({ utmSource: "x" })).toBe("Twitter");
    expect(classifySource({ utmSource: "FB" })).toBe("Facebook");
    expect(classifySource({ utmSource: "yt" })).toBe("YouTube");
  });

  test("unknown utm_source returned verbatim", () => {
    expect(classifySource({ utmSource: "partner-blog" })).toBe("partner-blog");
  });

  test("search engines collapse across region/TLD", () => {
    expect(classifySource({ refererHost: "www.google.com" })).toBe("Google");
    expect(classifySource({ refererHost: "google.co.uk" })).toBe("Google");
    expect(classifySource({ refererHost: "news.google.com" })).toBe("Google");
    expect(classifySource({ refererHost: "duckduckgo.com" })).toBe("DuckDuckGo");
  });

  test("known social/dev hosts map to friendly names", () => {
    expect(classifySource({ refererHost: "t.co" })).toBe("Twitter");
    expect(classifySource({ refererHost: "x.com" })).toBe("Twitter");
    expect(classifySource({ refererHost: "m.facebook.com" })).toBe("Facebook");
    expect(classifySource({ refererHost: "github.com" })).toBe("GitHub");
    expect(classifySource({ refererHost: "youtu.be" })).toBe("YouTube");
    expect(classifySource({ refererHost: "news.ycombinator.com" })).toBe(
      "Hacker News",
    );
  });

  test("hackclub subdomains map to Hack Club", () => {
    expect(classifySource({ refererHost: "hackclub.com" })).toBe("Hack Club");
    expect(classifySource({ refererHost: "blog.hackclub.com" })).toBe(
      "Hack Club",
    );
  });

  test("unknown host returned without www prefix", () => {
    expect(classifySource({ refererHost: "www.example.org" })).toBe(
      "example.org",
    );
    expect(classifySource({ refererHost: "some.blog.dev" })).toBe(
      "some.blog.dev",
    );
  });
});
