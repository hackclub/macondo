-- Per-user starred shop items. Mirrors the admin-set `pinned` flag on
-- shopItemTable but per-viewer: the public /shop renders starred items
-- directly above the rest of the grid (after pinned, before normal
-- items) so users can find their goal items without scrolling.
-- Composite unique index keeps each (user, item) pair unique without a
-- separate id column. ON DELETE CASCADE on both FKs so stars vanish if
-- the user or item goes away.

CREATE TABLE IF NOT EXISTS "shop_item_stars" (
  "user_id" text NOT NULL,
  "item_id" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "shop_item_stars"
    ADD CONSTRAINT "shop_item_stars_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "shop_item_stars"
    ADD CONSTRAINT "shop_item_stars_item_id_shop_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "shop_items"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "shop_item_stars_pk"
  ON "shop_item_stars" ("user_id", "item_id");
