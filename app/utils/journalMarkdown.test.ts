import { describe, expect, test } from "bun:test";

import { hasPlayableVideoExtension, renderJournalMarkdown } from "./journalMarkdown";

describe("hasPlayableVideoExtension", () => {
  test("true for browser-playable video extensions", () => {
    expect(hasPlayableVideoExtension("https://cdn.hackclub.com/a/clip.mp4")).toBe(true);
    expect(hasPlayableVideoExtension("https://cdn.hackclub.com/a/clip.webm")).toBe(true);
    expect(hasPlayableVideoExtension("https://cdn.hackclub.com/a/clip.MOV")).toBe(true);
  });
  test("false for images and unknown extensions", () => {
    expect(hasPlayableVideoExtension("https://cdn.hackclub.com/a/shot.png")).toBe(false);
    expect(hasPlayableVideoExtension("https://cdn.hackclub.com/a/file.pdf")).toBe(false);
  });
});

describe("renderJournalMarkdown", () => {
  test("renders a video-extension url as a <video> player, not an <img>", () => {
    const html = renderJournalMarkdown("![clip](https://cdn.hackclub.com/s/clip.mp4)");
    expect(html).toContain("<video");
    expect(html).toContain('src="https://cdn.hackclub.com/s/clip.mp4"');
    expect(html).toContain("controls");
    expect(html).not.toContain("<img");
  });

  test("renders a normal image url as an <img>", () => {
    const html = renderJournalMarkdown("![shot](https://cdn.hackclub.com/s/shot.png)");
    expect(html).toContain("<img");
    expect(html).not.toContain("<video");
  });

  test("forces target and rel on links", () => {
    const html = renderJournalMarkdown("[hc](https://hackclub.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("prepends https:// to links without a protocol", () => {
    expect(renderJournalMarkdown("[hc](hackclub.com)")).toContain('href="https://hackclub.com"');
  });

  test("strips disallowed raw html", () => {
    expect(renderJournalMarkdown("<script>alert(1)</script>hello")).not.toContain("<script");
  });
});
