import { defineNuxtModule } from "@nuxt/kit";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createMarkdownParser, createShikiHighlighter, rehypeHighlight } from "@nuxtjs/mdc/runtime";
import { bundledLanguages, bundledThemes } from "shiki";
import type { MDCNode } from "@nuxtjs/mdc";

// Keep the Markdown source editable, but ship only rendered trees and search text.
// No database, SQL WASM, Markdown parser or highlighter runs in the web instance.
export default defineNuxtModule({
  meta: { name: "macondo-docs-archive" },
  async setup(_options, nuxt) {
    const root = join(nuxt.options.rootDir, "content/docs");
    const output = join(nuxt.options.rootDir, "node_modules/.cache/macondo-docs");
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    const highlighter = createShikiHighlighter({ bundledLangs: bundledLanguages, bundledThemes });
    const parse = await createMarkdownParser({
      rehype: { plugins: { highlight: { instance: rehypeHighlight, options: { highlighter, theme: "vitesse-light" } } } },
    });
    const text = (node: MDCNode): string => "value" in node ? String(node.value) : "children" in node ? node.children.map(text).join(" ") : "";
    const manifest: Record<string, Record<string, unknown>[]> = {};
    for (const locale of ["en", "es"]) {
      const pages: Record<string, unknown>[] = [];
      const sections: Record<string, unknown>[] = [];
      const files = (await readdir(join(root, locale), { recursive: true })).filter(f => f.endsWith(".md")).sort();
      for (const file of files) {
        const source = await readFile(join(root, locale, file), "utf8");
        const parsed = await parse(source);
        const slug = file.replace(/\.md$/, "").replace(/(^|\/)index$/, "").replace(/\/$/, "");
        const path = `/docs/${locale}${slug ? `/${slug}` : ""}`;
        const page = { ...parsed.data, path, body: { ...parsed.body, toc: parsed.toc } };
        const json = JSON.stringify(page);
        const asset = `/${createHash("sha256").update(json).digest("hex").slice(0, 20)}.json`;
        await writeFile(join(output, asset.slice(1)), json);
        const meta = { ...parsed.data, path, asset: `/_docs${asset}` };
        pages.push(meta);
        let current = { ...meta, id: path, title: String(parsed.data.title ?? ""), titles: [] as string[], level: 1, content: "" };
        sections.push(current);
        const headings: string[] = [];
        for (const node of parsed.body.children) {
          if (node.type === "element" && /^h[1-6]$/.test(node.tag)) {
            const level = Number(node.tag[1]);
            headings.length = Math.min(headings.length, level - 1);
            const title = text(node);
            current = { ...meta, id: `${path}#${node.props?.id ?? ""}`, title, titles: [...headings], level, content: "" };
            headings[level - 1] = title;
            sections.push(current);
          } else {
            current.content += `${text(node)}\n`;
          }
        }
      }
      manifest[locale] = pages;
      await writeFile(join(output, `search-${locale}.json`), JSON.stringify(sections));
    }
    await writeFile(join(output, "manifest.json"), JSON.stringify(manifest));
    nuxt.options.alias["#docs-manifest"] = join(output, "manifest.json");
    nuxt.hook("nitro:config", config => {
      config.publicAssets ||= [];
      // Revalidated across deployments; page filenames themselves are content-addressed.
      config.publicAssets.push({ dir: output, baseURL: "/_docs", maxAge: 0 });
    });
    nuxt.options.watch.push(relative(nuxt.options.rootDir, root));
  },
});
