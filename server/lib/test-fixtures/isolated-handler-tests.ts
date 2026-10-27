import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const childFileEnv = "INTERNAL_HANDLER_TEST_CHILD";

// Bun's module mocks and Nuxt globals are process-wide. Only the child imports
// the mocked fixture; the ordinary test runner never installs either of them.
export async function isolatedHandlerTests(
  file: string,
  fixture: string,
  suite: string,
  names: string[],
) {
  if (process.env[childFileEnv] === file) {
    await import(fixture);
    return;
  }

  describe(suite, () => {
    for (const name of names) {
      test(name, async () => {
        const fullName = `${suite} ${name}`;
        const pattern = `^${fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
        const child = Bun.spawn([
          process.execPath, "test", fileURLToPath(file), "--test-name-pattern", pattern,
        ], {
          env: { ...process.env, [childFileEnv]: file },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        const output = stdout + stderr;
        expect(exitCode, output).toBe(0);
        // A typo in the selector must not silently turn a regression into a pass.
        expect(output).toContain("1 pass");
        expect(output).toContain("0 fail");
      });
    }
  });
}
