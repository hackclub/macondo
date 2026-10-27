import { describe, expect, test } from "bun:test";

import { isPubliclyResolvable, validateOutboundUrl } from "./outbound-url";

// Regression tests for the SSRF guard. Two classes of past bug are pinned:
// 1. JS bitwise masks are SIGNED, so `(n & 0xffff0000) === 0xa9fe0000` was
//    always false — 169.254/16 (cloud metadata) and 172.16/12 slipped every
//    IPv4 range check.
// 2. IPv6 reserved ranges hid behind shorthand: `::` (kernel connects via
//    loopback), hex-form IPv4-mapped (`::ffff:a9fe:a9fe`), NAT64, 6to4, and
//    the bracketed-literal pass-through.
//
// A URL listed under "rejected" must return an error string; "allowed" must
// return null (validation passes).

const REJECTED_URLS = [
  // IPv4 private/reserved (incl. the previously-broken signed-mask ranges)
  "http://10.0.0.5/",
  "http://172.16.0.9/",
  "http://172.31.255.255/",
  "http://192.168.1.10/",
  "http://169.254.169.254/latest/meta-data/",
  "http://100.64.0.1/",
  "http://0.0.0.0/",
  "http://255.255.255.255/",
  "http://127.0.0.1/",
  // IPv6 reserved / tunnelled forms
  "http://[::]/", // unspecified: the kernel connects via loopback
  "http://[::1]/",
  "http://[::ffff:a9fe:a9fe]/", // hex-form IPv4-mapped 169.254.169.254
  "http://[::ffff:127.0.0.1]/", // dotted IPv4-mapped 127.0.0.1
  "http://[64:ff9b::a9fe:a9fe]/", // NAT64 embedding 169.254.169.254
  "http://[2002:a9fe:a9fe::1]/", // 6to4 embedding 169.254.169.254
  "http://[2001:db8::1]/", // documentation
  "http://[fe80::1]/", // link-local
  "http://[fec0::1]/", // site-local (deprecated)
  "http://[fc00::1]/", // unique local
  "http://[fd12:3456:789a::1]/", // unique local (fd)
  "http://[ff02::1]/", // multicast
  // Scheme / port / credentials / syntax
  "file:///etc/passwd",
  "https://user:pass@example.com/",
  "https://example.com:3000/path",
  "http://localhost:3000/",
  // Note: wildcard-DNS hosts like 127.0.0.1.nip.io pass this SYNTAX check by
  // design — they're caught at the resolve stage (isPubliclyResolvable /
  // safeBufferRequest), which resolves DNS and rejects private answers.
];

const ALLOWED_URLS = [
  "https://example.com/",
  "http://8.8.8.8/",
  // Mapped/NAT64/6to4 forms embedding a PUBLIC IPv4 are allowed: the embedded
  // address decides, exactly like the plain IPv4 literal would.
  "http://[::ffff:8.8.8.8]/",
  "http://[64:ff9b::808:808]/",
  "http://[2002:0808:0808::1]/",
  "http://[2606:4700:4700::1111]/",
  "http://[2620:fe::fe]/",
];

describe("validateOutboundUrl", () => {
  test.each(REJECTED_URLS)("rejects %s", (url) => {
    expect(validateOutboundUrl(new URL(url))).not.toBeNull();
  });

  test.each(ALLOWED_URLS)("allows %s", (url) => {
    expect(validateOutboundUrl(new URL(url))).toBeNull();
  });
});

describe("isPubliclyResolvable", () => {
  // dns.lookup resolves IP literals without touching the network, so these
  // cases stay offline-safe.
  test.each([
    "::",
    "::1",
    "::ffff:a9fe:a9fe",
    "::ffff:169.254.169.254",
    "fe80::1",
    "fc00::1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::169.254.169.254", // dotted tail after a non-empty head counts as two groups
    "64:ff9b::127.0.0.1",
    "0:0:0:0:0:ffff:169.254.169.254",
  ])("treats %s as NOT publicly resolvable", async (host) => {
    expect(await isPubliclyResolvable(host)).toBe(false);
  });

  test.each(["8.8.8.8", "1.1.1.1", "64:ff9b::8.8.8.8"])("treats public literal %s as resolvable", async (host) => {
    expect(await isPubliclyResolvable(host)).toBe(true);
  });
});
