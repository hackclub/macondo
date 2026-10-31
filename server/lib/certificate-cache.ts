import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Reuse rendered files across requests/restarts on the single web instance. Routes
// still read the certificate from Postgres before looking in this cache, so a
// revoked or renamed certificate never reuses the previous visual.
export function createCertificateCache(directory = join(tmpdir(), "macondo-certificates-v1")) {
  const pending = new Map<string, Promise<Buffer>>();
  let writes = Promise.resolve();
  return async function cachedCertificate(key: unknown, extension: "png" | "pdf", render: () => Promise<Buffer>): Promise<Buffer> {
    const digest = createHash("sha256").update(JSON.stringify(key)).digest("hex");
    const filename = `${digest}.${extension}`;
    const existing = pending.get(filename);
    if (existing) return existing;
    const task = (async () => {
      const path = join(directory, filename);
      try { return await readFile(path); } catch { /* Cold cache or unavailable disk: render normally. */ }
      const result = await render();
      // Serial persistence keeps the disk bound valid even when different
      // certificates finish rendering at the same time.
      const persist = async () => {
        try {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          const files = (await readdir(directory)).filter(file => /^[a-f0-9]{64}\.(png|pdf)$/.test(file));
          if (files.length >= 256) {
            const entries = await Promise.all(files.map(async file => ({ file, time: (await stat(join(directory, file))).mtimeMs })));
            entries.sort((a, b) => a.time - b.time);
            await Promise.all(entries.slice(0, files.length - 255).map(entry => rm(join(directory, entry.file), { force: true })));
          }
          // Never publish a partial file if the process exits during a write.
          const temporary = `${path}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, result, { mode: 0o600 });
            await rename(temporary, path);
          } finally {
            await rm(temporary, { force: true });
          }
        } catch { /* A full/read-only temp directory must not break certificate downloads. */ }
      };
      writes = writes.then(persist, persist);
      await writes;
      return result;
    })();
    pending.set(filename, task);
    try { return await task; } finally { pending.delete(filename); }
  };
}

export const cachedCertificate = createCertificateCache();
