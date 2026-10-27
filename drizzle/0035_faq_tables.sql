-- FAQ system: DB-backed /docs/faq page + AI-generated suggestions queue.
--
-- faq_entries is the source of truth for what renders on the public help
-- FAQ page. Seeded with the 6 original hand-written items (migrated from
-- content/docs/{en,es}/faq.md). New items accepted from the internal FAQ
-- suggestions review panel are inserted with source='ai_generated'.
--
-- faq_suggestions holds AI-clustered question/answer candidates from recent
-- resolved support tickets, awaiting staff review. On accept, a row is
-- inserted into faq_entries and published_faq_id is backfilled so the link
-- between suggestion and published entry is preserved.

DO $$ BEGIN
  CREATE TYPE "faq_entry_source" AS ENUM ('manual', 'ai_generated');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "faq_suggestion_status" AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "faq_entries" (
  "id"           serial PRIMARY KEY,
  "question_en"  text NOT NULL,
  "answer_en"    text NOT NULL,
  "question_es"  text,
  "answer_es"    text,
  "source"       "faq_entry_source" NOT NULL DEFAULT 'manual',
  "sort_order"   integer NOT NULL DEFAULT 0,
  "created_at"   timestamp NOT NULL DEFAULT now(),
  "updated_at"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "faq_entries_sort_idx"
  ON "faq_entries" ("sort_order");

CREATE TABLE IF NOT EXISTS "faq_suggestions" (
  "id"                   serial PRIMARY KEY,
  "question_en"          text NOT NULL,
  "answer_en"            text NOT NULL,
  "question_es"          text,
  "answer_es"            text,
  "status"               "faq_suggestion_status" NOT NULL DEFAULT 'pending',
  "source_ticket_count"  integer NOT NULL DEFAULT 0,
  "source_ticket_ids"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "reviewed_by_user_id"  text REFERENCES "users"("id"),
  "reviewed_at"          timestamp,
  "published_faq_id"     integer REFERENCES "faq_entries"("id") ON DELETE SET NULL,
  "raw_ai_response"      text,
  "created_at"           timestamp NOT NULL DEFAULT now(),
  "updated_at"           timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "faq_suggestions_status_idx"
  ON "faq_suggestions" ("status");

CREATE INDEX IF NOT EXISTS "faq_suggestions_created_idx"
  ON "faq_suggestions" ("created_at");

-- Seed the 6 original FAQ items from content/docs/{en,es}/faq.md so the
-- public FAQ page is unchanged after the markdown stubs lose their bodies.
-- Guarded by a row-count check so re-running the migration is a no-op.
INSERT INTO "faq_entries" ("question_en", "answer_en", "question_es", "answer_es", "source", "sort_order")
SELECT * FROM (VALUES
  (
    'I''m a complete beginner. Can I still join?',
    'Absolutely! We have beginner-friendly guided projects and a community where you can ask for help anytime.',
    '¿Soy principiante total. ¿Puedo participar?',
    '¡Claro que sí! Tenemos proyectos guiados para principiantes y una comunidad donde puedes pedir ayuda cuando quieras.',
    'manual'::"faq_entry_source",
    0
  ),
  (
    'Who can participate?',
    'You must be a teenager between the ages of 13 and 18, and under 19 before August 2026.',
    '¿Quién puede participar?',
    'Debes ser un adolescente entre 13 y 18 años, y tener menos de 19 antes de agosto de 2026.',
    'manual'::"faq_entry_source",
    10
  ),
  (
    'Is this really free?',
    'Yes! The program is 100% free. We''ll fund your projects and cover the trip.',
    '¿Es realmente gratis?',
    '¡Sí! El programa es 100% gratis. Financiamos tus proyectos y cubrimos el viaje.',
    'manual'::"faq_entry_source",
    20
  ),
  (
    'What kind of projects can I build?',
    'Anything you want! Personal websites, games, apps, hardware projects. As long as you''re learning and building, it counts.',
    '¿Qué tipo de proyectos puedo construir?',
    '¡Lo que quieras! Sitios web personales, juegos, apps, proyectos de hardware. Siempre que estés aprendiendo y construyendo, cuenta.',
    'manual'::"faq_entry_source",
    30
  ),
  (
    'What is Hack Club?',
    'Hack Club is a 501(c)(3) nonprofit (EIN: 81-2908499) that helps high school students learn to code and build projects. We''re the largest teen-led coding community, with over 50,000 students building with friends each year.',
    '¿Qué es Hack Club?',
    'Hack Club es una organización sin fines de lucro 501(c)(3) (EIN: 81-2908499) que ayuda a estudiantes de secundaria a aprender a programar y construir proyectos. Somos la comunidad de programación liderada por adolescentes más grande, con más de 50,000 estudiantes construyendo con amigos cada año.',
    'manual'::"faq_entry_source",
    40
  ),
  (
    'I have more questions!',
    'Ask us in #macondo on the Hack Club Slack, or email us at macondo@hackclub.com!',
    '¡Tengo más preguntas!',
    '¡Pregúntanos en #macondo en el Slack de Hack Club, o escríbenos a macondo@hackclub.com!',
    'manual'::"faq_entry_source",
    50
  )
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM "faq_entries");
