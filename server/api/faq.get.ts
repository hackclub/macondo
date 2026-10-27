import { asc } from "drizzle-orm";

import db from "../db";
import { faqEntryTable } from "../db/schema";

// Spanish falls back to English when null, since AI-generated rows may be English-only.
export default defineCachedEventHandler(
  async (event) => {
    const locale = getQuery(event).locale === "es" ? "es" : "en";

    const items = (await db
      .select({
        id: faqEntryTable.id,
        question_en: faqEntryTable.question_en,
        answer_en: faqEntryTable.answer_en,
        question_es: faqEntryTable.question_es,
        answer_es: faqEntryTable.answer_es,
        source: faqEntryTable.source,
        sort_order: faqEntryTable.sort_order,
      })
      .from(faqEntryTable)
      .orderBy(asc(faqEntryTable.sort_order), asc(faqEntryTable.id))).map((r) => ({
      id: r.id,
      question:
        locale === "es" && r.question_es
          ? r.question_es
          : r.question_en,
      answer:
        locale === "es" && r.answer_es
          ? r.answer_es
          : r.answer_en,
    }));

    return { items, locale };
  },
  {
    maxAge: 60 * 5,
    swr: true,
    getKey: (event) => {
      return `faq:${getQuery(event).locale === "es" ? "es" : "en"}`;
    },
  },
);
