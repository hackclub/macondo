import { expect, spyOn, test } from "bun:test";

test("error hook logs only server status and does not inspect request credentials", async () => {
  const globals = globalThis as any;
  const previous = globals.defineNitroPlugin;
  globals.defineNitroPlugin = (plugin: unknown) => plugin;
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const { default: plugin } = await import("../plugins/error-logging");
    let hook: any;
    plugin({ hooks: { hook: (_name: string, callback: unknown) => { hook = callback; } } } as any);
    const secret = "private-token-and-email@example.com";
    const error = Object.assign(new Error(secret), {
      statusCode: 503,
      request: { headers: { Authorization: secret } },
    });
    hook(error, { get event() { throw new Error("must not read request context"); } });
    expect(log.mock.calls).toEqual([["[error-hook] server request failed", { statusCode: 503 }]]);
    hook({ statusCode: 404 });
    expect(log).toHaveBeenCalledTimes(1);
    hook(new Error(secret));
    expect(log.mock.calls[1]).toEqual(["[error-hook] server request failed", { statusCode: 500 }]);
  } finally {
    log.mockRestore();
    globals.defineNitroPlugin = previous;
  }
});
