import { describe, expect, test } from "bun:test";

import {
  buildMirroredSlackReplyValues,
  SLACK_EXTERNAL_AUTHOR_KIND,
} from "./support-ticket-mirror";

describe("buildMirroredSlackReplyValues", () => {
  test("linked Macondo user is attributed normally", () => {
    const row = buildMirroredSlackReplyValues({
      ticketId: 42,
      slackUserId: "U123",
      author: { user_id: "user-abc", name: "Jainil", avatar: "https://img/a.png" },
      body: "thanks!",
      slackTs: "1700.0001",
    });

    expect(row.ticket_id).toBe(42);
    expect(row.author_user_id).toBe("user-abc");
    expect(row.author_kind).toBe("user");
    expect(row.is_internal_note).toBe(false);
    expect(row.slack_ts).toBe("1700.0001");
    expect(row.slack_author_id ?? null).toBeNull();
    expect(row.slack_author_name ?? null).toBeNull();
    expect(row.slack_author_image ?? null).toBeNull();
  });

  test("community member with no linked account is still captured", () => {
    const row = buildMirroredSlackReplyValues({
      ticketId: 42,
      slackUserId: "U999",
      author: { user_id: null, name: "kyle.mason", avatar: "https://img/k.png" },
      body: "You spend a certain amount of hours...",
      slackTs: "1700.0002",
    });

    expect(row.ticket_id).toBe(42);
    expect(row.author_user_id ?? null).toBeNull();
    expect(row.author_kind).toBe(SLACK_EXTERNAL_AUTHOR_KIND);
    expect(row.is_internal_note).toBe(false);
    expect(row.body).toBe("You spend a certain amount of hours...");
    expect(row.slack_author_id).toBe("U999");
    expect(row.slack_author_name).toBe("kyle.mason");
    expect(row.slack_author_image).toBe("https://img/k.png");
  });

  test("external author with an unresolvable profile keeps null identity, not a drop", () => {
    const row = buildMirroredSlackReplyValues({
      ticketId: 7,
      slackUserId: "U000",
      author: { user_id: null, name: null, avatar: null },
      body: "(attachment)",
      slackTs: null,
    });

    expect(row.author_kind).toBe(SLACK_EXTERNAL_AUTHOR_KIND);
    expect(row.slack_author_id).toBe("U000");
    expect(row.slack_author_name ?? null).toBeNull();
    expect(row.slack_author_image ?? null).toBeNull();
  });
});
