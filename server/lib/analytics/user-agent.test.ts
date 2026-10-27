import { describe, expect, test } from "bun:test";

import { bucketScreenSize, isBot, parseUserAgent } from "./user-agent";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const FIREFOX_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const SAFARI_IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

describe("parseUserAgent browser detection", () => {
  test("Chrome on Windows", () => {
    expect(parseUserAgent(CHROME_WIN).browser).toBe("Chrome");
  });
  test("Edge wins over the Chrome token it embeds", () => {
    expect(parseUserAgent(EDGE_WIN).browser).toBe("Edge");
  });
  test("Safari, not Chrome, on macOS", () => {
    expect(parseUserAgent(SAFARI_MAC).browser).toBe("Safari");
  });
  test("Firefox", () => {
    expect(parseUserAgent(FIREFOX_LINUX).browser).toBe("Firefox");
  });
});

describe("parseUserAgent os detection", () => {
  test("Windows", () => expect(parseUserAgent(CHROME_WIN).os).toBe("Windows"));
  test("macOS", () => expect(parseUserAgent(SAFARI_MAC).os).toBe("macOS"));
  test("Linux", () => expect(parseUserAgent(FIREFOX_LINUX).os).toBe("Linux"));
  test("Android", () =>
    expect(parseUserAgent(CHROME_ANDROID).os).toBe("Android"));
  test("iOS", () => expect(parseUserAgent(SAFARI_IPHONE).os).toBe("iOS"));
});

describe("parseUserAgent device type", () => {
  test("desktop", () =>
    expect(parseUserAgent(CHROME_WIN).deviceType).toBe("desktop"));
  test("phone is mobile", () =>
    expect(parseUserAgent(CHROME_ANDROID).deviceType).toBe("mobile"));
  test("iPhone is mobile", () =>
    expect(parseUserAgent(SAFARI_IPHONE).deviceType).toBe("mobile"));
  test("iPad is tablet", () =>
    expect(parseUserAgent(SAFARI_IPAD).deviceType).toBe("tablet"));
  test("Android without Mobile token is tablet", () =>
    expect(parseUserAgent(ANDROID_TABLET).deviceType).toBe("tablet"));
});

describe("parseUserAgent empty input", () => {
  test("null returns all nulls", () => {
    expect(parseUserAgent(null)).toEqual({
      browser: null,
      os: null,
      deviceType: null,
    });
  });
});

describe("isBot", () => {
  test("empty / missing UA is a bot", () => {
    expect(isBot("")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(undefined)).toBe(true);
  });
  test("real browsers are not bots", () => {
    expect(isBot(CHROME_WIN)).toBe(false);
    expect(isBot(SAFARI_IPHONE)).toBe(false);
    expect(isBot(EDGE_WIN)).toBe(false);
  });
  test("known crawlers are bots", () => {
    expect(
      isBot(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      ),
    ).toBe(true);
    expect(isBot("Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)")).toBe(
      true,
    );
    expect(isBot("curl/8.4.0")).toBe(true);
    expect(isBot("python-requests/2.31.0")).toBe(true);
    expect(
      isBot(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36",
      ),
    ).toBe(true);
  });
});

describe("bucketScreenSize", () => {
  test("buckets by width", () => {
    expect(bucketScreenSize(400)).toBe("Mobile");
    expect(bucketScreenSize(768)).toBe("Tablet");
    expect(bucketScreenSize(1280)).toBe("Laptop");
    expect(bucketScreenSize(1920)).toBe("Desktop");
  });
  test("invalid widths return null", () => {
    expect(bucketScreenSize(0)).toBeNull();
    expect(bucketScreenSize(-5)).toBeNull();
    expect(bucketScreenSize(null)).toBeNull();
    expect(bucketScreenSize(Number.NaN)).toBeNull();
  });
});
