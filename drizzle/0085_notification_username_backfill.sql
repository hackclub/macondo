-- Rewrite historical in-app notifications that embedded a user's legal name
-- so they show the user's username instead. Two notification types currently
-- interpolate a name into the body: project_upvoted and ticket_reopened
-- (see server/api/projects/[id]/upvote.post.ts and
-- server/api/support/tickets/[id]/messages.post.ts). Slack and email
-- payloads are not stored in the DB, so there is nothing else to rewrite.
--
-- The body formats are:
--   project_upvoted: "<name> upvoted <project_name>"
--   ticket_reopened: "<name> sent a new reply on a ticket you previously resolved."
--
-- Strategy: anchor the LIKE pattern to the literal suffix that follows the
-- name ("upvoted "/"sent a new reply") so a name like "Alex" cannot match
-- inside an unrelated string. After REPLACE rewrites the row, the same LIKE
-- no longer matches, so re-running this migration is a no-op (idempotent).
-- We also skip users where username equals name to avoid pointless rewrites
-- and skip users with NULL username so we never create a NULL prefix.

UPDATE "notifications" n
SET "body" = REPLACE(n."body", u."name" || ' upvoted ', u."username" || ' upvoted ')
FROM "users" u
WHERE n."type" = 'project_upvoted'
  AND u."username" IS NOT NULL
  AND u."name" IS NOT NULL
  AND u."username" <> u."name"
  AND n."body" LIKE u."name" || ' upvoted %';

UPDATE "notifications" n
SET "body" = REPLACE(n."body", u."name" || ' sent a new reply', u."username" || ' sent a new reply')
FROM "users" u
WHERE n."type" = 'ticket_reopened'
  AND u."username" IS NOT NULL
  AND u."name" IS NOT NULL
  AND u."username" <> u."name"
  AND n."body" LIKE u."name" || ' sent a new reply%';
