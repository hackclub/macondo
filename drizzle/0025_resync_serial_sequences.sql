-- Resync every serial sequence in the public schema so its next value
-- is greater than MAX(id) of its owning table. Shop-item inserts were
-- crashing with "duplicate key value violates unique constraint
-- shop_items_pkey" because shop_items_id_seq fell behind MAX(id)
-- (rows imported with explicit ids bypassed the sequence), so nextval
-- handed out an id that already existed. Sweeping every serial
-- sequence prevents the same class of failure on any other table
-- whose sequence drifted for the same reason (imports, pg_restore,
-- manual inserts).
--
-- Only advances sequences, never rolls them back. If a sequence is
-- already ahead of MAX(id) (e.g. because rows were deleted), it's
-- left alone so reused ids can't collide with app caches or foreign
-- references that still remember the higher value.
DO $$
DECLARE
    r RECORD;
    max_id BIGINT;
    seq_name TEXT;
    next_val BIGINT;
BEGIN
    FOR r IN
        SELECT n.nspname AS schema_name,
               c.relname AS table_name,
               a.attname AS column_name
        FROM pg_class c
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
          AND pg_get_expr(ad.adbin, ad.adrelid) LIKE 'nextval(%'
    LOOP
        seq_name := pg_get_serial_sequence(
            format('%I.%I', r.schema_name, r.table_name),
            r.column_name
        );
        IF seq_name IS NULL THEN
            CONTINUE;
        END IF;

        EXECUTE format(
            'SELECT COALESCE(MAX(%I), 0) FROM %I.%I',
            r.column_name, r.schema_name, r.table_name
        ) INTO max_id;

        -- What would nextval return right now? last_value + 1 when
        -- is_called=true, last_value when is_called=false.
        EXECUTE format(
            'SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM %s',
            seq_name
        ) INTO next_val;

        -- Only bump if the sequence is behind or exactly at MAX(id).
        IF max_id >= next_val THEN
            PERFORM setval(seq_name, max_id, true);
        END IF;
    END LOOP;
END
$$;
