import { defineSitemapEventHandler } from "#imports";
import { archiveDocs } from "~~/shared/docs-archive";
import type { SitemapUrlInput } from "#sitemap/types";

// en and es share one `/docs/<slug>` URL (i18n no_prefix), linked via hreflang alternates.
export default defineSitemapEventHandler(() => {
  const en = archiveDocs("en");
  const es = archiveDocs("es");

  const stripLocale = (p: string): string =>
    p.replace(/^\/docs\/(en|es)\/?/, "/docs/").replace(/\/+$/, "") || "/docs";

  const bySlug = new Map<string, { en: boolean; es: boolean }>();
  for (const d of en) {
    const slug = stripLocale(String(d.path));
    bySlug.set(slug, { ...(bySlug.get(slug) ?? { en: false, es: false }), en: true });
  }
  for (const d of es) {
    const slug = stripLocale(String(d.path));
    bySlug.set(slug, { ...(bySlug.get(slug) ?? { en: false, es: false }), es: true });
  }

  return [...bySlug.entries()].map(([slug, has]): SitemapUrlInput => ({
    loc: slug,
    alternatives: [
      has.en && { hreflang: "en", href: slug },
      has.es && { hreflang: "es", href: slug },
      { hreflang: "x-default", href: slug },
    ].filter(Boolean) as Array<{ hreflang: string; href: string }>,
  }));
});
