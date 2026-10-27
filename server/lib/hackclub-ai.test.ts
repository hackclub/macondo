import { describe, expect, mock, test } from "bun:test";

mock.module("#imports", () => ({
  useRuntimeConfig: () => ({ hackclubAiKey: "test-key" }),
}));

const { aiEmbed } = await import("./hackclub-ai");

describe("aiEmbed", () => {
  test("returns null when API returns 404 (embeddings not supported)", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    try {
      expect(await aiEmbed("hello world")).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("returns the embedding vector on success", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
    try {
      expect(await aiEmbed("hello world")).toEqual([0.1, 0.2, 0.3]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
