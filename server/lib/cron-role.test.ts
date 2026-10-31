import { afterEach, expect, test } from "bun:test";
import { shouldRunCronPlugins } from "./cron-role";

const originalNodeEnv = process.env.NODE_ENV;
const originalRole = process.env.MACONDO_ROLE;
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalRole === undefined) delete process.env.MACONDO_ROLE;
  else process.env.MACONDO_ROLE = originalRole;
});

test("production web runs jobs with the existing web role or no role", () => {
  process.env.NODE_ENV = "production";
  process.env.MACONDO_ROLE = "web";
  expect(shouldRunCronPlugins()).toBe(true);
  delete process.env.MACONDO_ROLE;
  expect(shouldRunCronPlugins()).toBe(true);
});

test("legacy worker configuration cannot enable jobs outside production", () => {
  process.env.MACONDO_ROLE = "worker";
  for (const environment of ["development", "test"]) {
    process.env.NODE_ENV = environment;
    expect(shouldRunCronPlugins()).toBe(false);
  }
  delete process.env.NODE_ENV;
  expect(shouldRunCronPlugins()).toBe(false);
});
