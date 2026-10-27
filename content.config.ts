import { defineCollection, defineContentConfig, z } from "@nuxt/content";

// One collection per locale; pages strip the locale prefix so URLs stay `/docs/{slug}`.
const docSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  keywords: z.string().optional(),
  section: z.string().optional(),
  order: z.number().optional(),
  icon: z.string().optional(),
  group: z.string().optional(),
  groupTitle: z.string().optional(),
  groupOrder: z.number().optional(),
  requiresJournal: z.boolean().optional(),
});

export default defineContentConfig({
  collections: {
    docs_en: defineCollection({
      type: "page",
      source: "docs/en/**",
      schema: docSchema,
    }),
    docs_es: defineCollection({
      type: "page",
      source: "docs/es/**",
      schema: docSchema,
    }),
  },
});
