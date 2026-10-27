// Guards against regressing to the old body-only scheme, which 401'd every ARI delivery.

import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { ariOutboundSignatureMatches } from "./ari-signature";

const SECRET = "whsec_testsecret_0123456789abcdef";
const BODY = JSON.stringify({
  event: "review.changes",
  decision: "changes",
  id: "ba9qn7gk",
  external_id: "1234",
  review: { note_to_maker: "please fix the demo link" },
});
const TIMESTAMP = "1718470000";
const DELIVERY_ID = "dlv_abc123";

// How ARI signs an outbound delivery (ari/src/lib/server/outbound.ts).
function ariSign(
  secret: string,
  timestamp: string,
  deliveryId: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${deliveryId}.${body}`, "utf8")
    .digest("hex");
}

describe("ariOutboundSignatureMatches", () => {
  test("accepts a correctly signed timestamped delivery", () => {
    expect(
      ariOutboundSignatureMatches(
        SECRET,
        BODY,
        ariSign(SECRET, TIMESTAMP, DELIVERY_ID, BODY),
        TIMESTAMP,
        DELIVERY_ID,
      ),
    ).toBe(true);
  });

  test("rejects the old body-only signature (the bug we fixed)", () => {
    // What pre-timestamp ARI sent: a bare HMAC of the body.
    expect(
      ariOutboundSignatureMatches(
        SECRET,
        BODY,
        createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex"),
        TIMESTAMP,
        DELIVERY_ID,
      ),
    ).toBe(false);
  });

  test("rejects a tampered timestamp", () => {
    expect(
      ariOutboundSignatureMatches(
        SECRET,
        BODY,
        ariSign(SECRET, TIMESTAMP, DELIVERY_ID, BODY),
        "1718479999",
        DELIVERY_ID,
      ),
    ).toBe(false);
  });

  test("rejects a tampered delivery id", () => {
    expect(
      ariOutboundSignatureMatches(
        SECRET,
        BODY,
        ariSign(SECRET, TIMESTAMP, DELIVERY_ID, BODY),
        TIMESTAMP,
        "dlv_other",
      ),
    ).toBe(false);
  });

  test("rejects a tampered body", () => {
    expect(
      ariOutboundSignatureMatches(
        SECRET,
        BODY + " ",
        ariSign(SECRET, TIMESTAMP, DELIVERY_ID, BODY),
        TIMESTAMP,
        DELIVERY_ID,
      ),
    ).toBe(false);
  });

  test("rejects the wrong secret", () => {
    expect(
      ariOutboundSignatureMatches(
        SECRET,
        BODY,
        ariSign("whsec_someoneelse", TIMESTAMP, DELIVERY_ID, BODY),
        TIMESTAMP,
        DELIVERY_ID,
      ),
    ).toBe(false);
  });

  test("accepts an upper-case hex signature (header is normalized)", () => {
    expect(
      ariOutboundSignatureMatches(
        SECRET,
        BODY,
        ariSign(SECRET, TIMESTAMP, DELIVERY_ID, BODY).toUpperCase(),
        TIMESTAMP,
        DELIVERY_ID,
      ),
    ).toBe(true);
  });

  const missingCases: Array<
    [string, string | undefined, string | undefined, string | undefined, string | undefined]
  > = [
    ["missing secret", undefined, "sig", TIMESTAMP, DELIVERY_ID],
    ["missing signature", SECRET, undefined, TIMESTAMP, DELIVERY_ID],
    ["missing timestamp", SECRET, "sig", undefined, DELIVERY_ID],
    ["missing delivery id", SECRET, "sig", TIMESTAMP, undefined],
  ];
  for (const [label, secret, sig, ts, dlv] of missingCases) {
    test(`fails closed when ${label}`, () => {
      expect(ariOutboundSignatureMatches(secret, BODY, sig, ts, dlv)).toBe(false);
    });
  }
});
