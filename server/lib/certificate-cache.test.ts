import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCertificateCache } from "./certificate-cache";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

test("certificate cache survives a new cache instance and separates formats and validity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "macondo-cert-test-"));
  directories.push(dir);
  let renders = 0;
  const render = async () => Buffer.from(`render ${++renders}`);
  const cert = { code: "test", valid: true, recipient_name: "Test Person" };
  const cache = createCertificateCache(dir);
  expect((await cache(cert, "png", render)).toString()).toBe("render 1");
  expect((await createCertificateCache(dir)(cert, "png", render)).toString()).toBe("render 1");
  expect((await cache({ ...cert, valid: false }, "png", render)).toString()).toBe("render 2");
  expect((await cache({ ...cert, recipient_name: "Updated Name" }, "png", render)).toString()).toBe("render 3");
  expect((await cache(cert, "pdf", render)).toString()).toBe("render 4");
});

test("concurrent certificate requests share one render; failed renders can retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "macondo-cert-test-"));
  directories.push(dir);
  const cache = createCertificateCache(dir);
  let renders = 0;
  const render = async () => { renders++; return Buffer.from("png"); };
  await Promise.all(Array.from({ length: 10 }, () => cache("same", "png", render)));
  expect(renders).toBe(1);
  await expect(cache("retry", "png", async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect((await cache("retry", "png", render)).toString()).toBe("png");
});

test("unwritable cache storage still returns the generated certificate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "macondo-cert-test-"));
  directories.push(dir);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "file"), "not a directory");
  const cache = createCertificateCache(join(dir, "file", "cache"));
  expect((await cache("key", "png", async () => Buffer.from("png"))).toString()).toBe("png");
});

test("concurrent distinct renders cannot grow the disk cache beyond its bound", async () => {
  const dir = await mkdtemp(join(tmpdir(), "macondo-cert-test-"));
  directories.push(dir);
  const cache = createCertificateCache(dir);
  await Promise.all(Array.from({ length: 260 }, (_, index) => cache(index, "png", async () => Buffer.from("png"))));
  expect((await readdir(dir)).length).toBe(256);
});
