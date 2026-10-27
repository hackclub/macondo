// These builders feed v-html sinks in the app origin, so a hole here is script execution.

import { describe, expect, test } from "bun:test";
import { esc, highlightHtml, inlineMarkdown } from "./formatting";

describe("highlightHtml", () => {
  test("a second < inside a tag cannot smuggle a live element through", () => {
    const out = highlightHtml(`<div a="b" <img src=x onerror=alert(1) >`);
    // A highlighter must still show the source, so assert no live element, not absence.
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
    for (const tag of out.match(/<[a-zA-Z/][^>]*>/g) ?? []) {
      expect(tag).toMatch(/^<\/?span/);
    }
  });

  test("still escapes when no attribute matches at all", () => {
    expect(highlightHtml(`<p <script>`)).not.toContain("<script");
  });

  test("the only tags it emits are its own highlight spans", () => {
    const out = highlightHtml(`<a href="/x" title='y'>hi</a>`);
    for (const tag of out.match(/<[a-zA-Z/][^>]*>/g) ?? []) {
      expect(tag).toMatch(/^<\/?span/);
    }
    // Highlighting still happened, i.e. this is not passing by escaping all.
    expect(out).toContain('<span class="text-emerald-600">"/x"</span>');
  });
});

describe("inlineMarkdown", () => {
  test("drops javascript: link targets", () => {
    // Backticks, not parens: the ([^)]+) capture stops at the first ")".
    const out = inlineMarkdown("[click me](javascript:alert`1`)");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="#"');
  });

  test("drops data: and protocol-relative targets", () => {
    expect(inlineMarkdown("[x](data:text/html,<script>alert(1)</script>)"))
      .toContain('href="#"');
    expect(inlineMarkdown("[x](//evil.example)")).toContain('href="#"');
    expect(inlineMarkdown("![x](javascript:alert`1`)")).toContain('src="#"');
  });

  test("keeps the ordinary link shapes intact", () => {
    expect(inlineMarkdown("[a](https://hackclub.com)")).toContain('href="https://hackclub.com"');
    expect(inlineMarkdown("[a](/docs)")).toContain('href="/docs"');
    expect(inlineMarkdown("[a](#anchor)")).toContain('href="#anchor"');
    expect(inlineMarkdown("[a](mailto:x@y.com)")).toContain('href="mailto:x@y.com"');
    expect(inlineMarkdown("![pic](./cat.png)")).toContain('src="./cat.png"');
  });

  test("a url cannot break out of the attribute even unescaped", () => {
    // The caller pre-escapes, but the function must be safe on its own.
    expect(inlineMarkdown('[x](https://a" onmouseover="alert(1))')).not.toContain('onmouseover="alert');
  });
});

describe("esc", () => {
  test("covers the characters the builders above depend on", () => {
    expect(esc(`<>&"`)).toBe("&lt;&gt;&amp;&quot;");
  });
});
