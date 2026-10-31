import { expect, test } from "bun:test";
import sanitizer from "./sanitize";

const options = {
  ALLOWED_TAGS: ["p", "a", "img", "video", "code"],
  ALLOWED_ATTR: ["href", "src", "alt", "class", "controls", "preload"],
};

test("untrusted HTML cannot execute scripts or active URL schemes", () => {
  const output = sanitizer.sanitize('<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="jav&#x61;script:alert(1)">link</a><svg><a xlink:href="javascript:alert(1)">svg</a></svg><iframe srcdoc="<script>alert(1)</script>"></iframe>', options);
  expect(output).not.toMatch(/<(?:script|iframe|svg)\b|onerror|xlink|srcdoc|javascript:/i);
  expect(output).toContain("link");
});

test("safe media and code survive, while data URLs and forbidden images do not", () => {
  const output = sanitizer.sanitize('<video controls preload="metadata" src="https://cdn.example/video.mp4"></video><code>&lt;script&gt;</code><img src="data:image/svg+xml,evil">', options);
  expect(output).toContain('src="https://cdn.example/video.mp4"');
  expect(output).toContain("controls");
  expect(output).toContain("&lt;script&gt;");
  expect(output).not.toContain("data:");
  expect(sanitizer.sanitize('<img src="https://example.com/x.png">', { ...options, FORBID_TAGS: ["img"] })).not.toContain("<img");
});
