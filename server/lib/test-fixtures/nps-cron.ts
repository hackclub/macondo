import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

const sync = mock(async () => ({ synced: 0, errors: 0, remaining: 0 }));
mock.module("../nps-airtable-sync", () => ({ syncNpsToAirtable: sync }));

type Timer = { callback: () => void; delay: number; cleared: boolean };
const timeouts: Timer[] = [];
const intervals: Timer[] = [];
const original = {
  setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval,
  clearTimeout: globalThis.clearTimeout, clearInterval: globalThis.clearInterval,
  nodeEnv: process.env.NODE_ENV, role: process.env.MACONDO_ROLE,
};
let plugin: (typeof import("../../plugins/nps-airtable-sync-cron"))["default"];
beforeAll(async () => {
  Object.assign(globalThis, { defineNitroPlugin: (callback: typeof plugin) => callback });
  plugin = (await import("../../plugins/nps-airtable-sync-cron")).default;
});
afterEach(() => {
  Object.assign(globalThis, {
    setTimeout: original.setTimeout, setInterval: original.setInterval,
    clearTimeout: original.clearTimeout, clearInterval: original.clearInterval,
  });
  if (original.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = original.nodeEnv;
  if (original.role === undefined) delete process.env.MACONDO_ROLE;
  else process.env.MACONDO_ROLE = original.role;
});

function start(environment: string) {
  process.env.NODE_ENV = environment;
  process.env.MACONDO_ROLE = "web";
  Object.assign(globalThis, {
    setTimeout: (callback: () => void, delay: number) => {
      const timer = { callback, delay, cleared: false }; timeouts.push(timer); return timer;
    },
    setInterval: (callback: () => void, delay: number) => {
      const timer = { callback, delay, cleared: false }; intervals.push(timer); return timer;
    },
    clearTimeout: (timer: Timer) => { timer.cleared = true; },
    clearInterval: (timer: Timer) => { timer.cleared = true; },
  });
  const closeCallbacks: Array<() => void> = [];
  plugin({ hooks: { hook: (name: string, callback: () => void) => {
    expect(name).toBe("close"); closeCallbacks.push(callback);
  } } } as unknown as Parameters<typeof plugin>[0]);
  return () => closeCallbacks.forEach(callback => callback());
}

describe("inline NPS cron", () => {
  test("production web schedules startup and recurring sync and cleans up timers", async () => {
    const close = start("production");
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]!.delay).toBe(90_000);
    expect(sync).not.toHaveBeenCalled();
    timeouts[0]!.callback();
    await new Promise<void>(resolve => original.setTimeout(resolve, 0));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(intervals).toHaveLength(1);
    expect(intervals[0]!.delay).toBe(30 * 60 * 1000);
    intervals[0]!.callback();
    await new Promise<void>(resolve => original.setTimeout(resolve, 0));
    expect(sync).toHaveBeenCalledTimes(2);
    close();
    expect(timeouts[0]!.cleared).toBe(true);
    expect(intervals[0]!.cleared).toBe(true);
  });

  test("development does not schedule or run sync", () => {
    start("development");
    expect(timeouts).toHaveLength(0);
    expect(intervals).toHaveLength(0);
    expect(sync).not.toHaveBeenCalled();
  });

  test("slow syncs cannot overlap the next tick", async () => {
    let finish!: (result: { synced: number; errors: number; remaining: number }) => void;
    sync.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const close = start("production");
    timeouts[0]!.callback();
    intervals[0]!.callback();
    expect(sync).toHaveBeenCalledTimes(1);
    finish({ synced: 0, errors: 0, remaining: 0 });
    await new Promise<void>(resolve => original.setTimeout(resolve, 0));
    intervals[0]!.callback();
    expect(sync).toHaveBeenCalledTimes(2);
    close();
  });
});
