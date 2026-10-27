// SSRF-safe: requests are pinned to the resolved public IP via `lookup`, reject
// private/reserved addresses, cap the body and time out.
import { promises as dns } from "dns";
import type { LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

type ResolvedAddress = {
  address: string;
  family: number;
};

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string,
  family: number,
) => void;

type LookupAllCallback = (
  err: NodeJS.ErrnoException | null,
  addresses: LookupAddress[],
) => void;

export const REQUEST_TIMEOUT_MS = 5000;
export const MAX_RESPONSE_BYTES = 256 * 1024;
// Some WAFs 403 non-browser agents, so the playable-URL probe can override this.
export const DEFAULT_USER_AGENT = "MacondoBot/1.0";

export type SafeRequestOptions = {
  method?: "GET" | "HEAD";
  userAgent?: string;
  timeoutMs?: number;
  /** Response byte cap; defaults to MAX_RESPONSE_BYTES. Larger callers (e.g. media rehosting) may raise it. */
  maxBytes?: number;
  /** Extra request headers (e.g. a bearer for authenticated public hosts). */
  headers?: Record<string, string>;
};

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  if (ip.split(".").length !== 4) return false;
  const n = ipv4ToInt(ip);

  // Unsigned shifts: `n & 0xffff0000` yields a SIGNED int32 in JS, so hex
  // literals with bit 31 set (0xa9fe…, 0xac1…, 0xc0a8…) never matched —
  // 169.254/16 (cloud metadata) and 172.16/12 slipped every check.
  if ((n >>> 24) === 0x0a) return true; // 10/8
  if ((n >>> 20) === 0xac1) return true; // 172.16/12
  if ((n >>> 16) === 0xc0a8) return true; // 192.168/16
  if ((n >>> 24) === 0x7f) return true; // 127/8
  if ((n >>> 16) === 0xa9fe) return true; // 169.254/16 (link-local + cloud metadata)
  if ((n >>> 22) === 0x191) return true; // 100.64/10 (CGNAT)
  if ((n >>> 24) === 0x00) return true; // 0/8
  if (n === 0xffffffff) return true; // broadcast

  return false;
}

// 128-bit IPv6 math so reserved ranges can't hide behind shorthand. String
// prefix checks miss `::` (kernel -> loopback), hex-form IPv4-mapped
// addresses (`::ffff:a9fe:a9fe`), NAT64, 6to4, and Teredo tunnels.
function ipv6ToBigInt(ip: string): bigint | null {
  const normalized = ip.toLowerCase().split("%")[0]!; // drop zone id
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const dottedTail = normalized.includes(".") ? 1 : 0; // a dotted ipv4 tail fills two groups

  let groups: string[];
  if (halves.length === 2) {
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves[1] ? halves[1].split(":") : [];
    const fill = 8 - head.length - tail.length - dottedTail;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else {
    groups = normalized.split(":");
    if (groups.length + dottedTail !== 8) return null;
  }

  let value = 0n;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group === undefined || group === "") return null;
    if (group.includes(".")) {
      if (i !== groups.length - 1) return null;
      const octets = group.split(".");
      if (
        octets.length !== 4 ||
        octets.some((o) => !/^\d+$/.test(o) || Number(o) > 255)
      ) {
        return null;
      }
      value = (value << 16n) | BigInt((Number(octets[0]) << 8) + Number(octets[1]));
      value = (value << 16n) | BigInt((Number(octets[2]) << 8) + Number(octets[3]));
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function intToIpv4(n: number): string {
  return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
}

function isPrivateIPv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip);
  // Unparseable literals are treated as reserved: fail closed rather than
  // let a malformed form slip the range checks.
  if (value === null) return true;

  if (value === 0n) return true; // :: unspecified (kernel connects via loopback)
  if (value === 1n) return true; // ::1 loopback

  // IPv4-mapped (::ffff:0:0/96) in both dotted and hex form.
  if ((value >> 32n) === 0x00000000000000000000ffffn) {
    return isPrivateIPv4(intToIpv4(Number(value & 0xffffffffn)));
  }
  // NAT64 (64:ff9b::/96): the low 32 bits are an IPv4 address.
  if ((value >> 32n) === 0x0064ff9b0000000000000000n) {
    return isPrivateIPv4(intToIpv4(Number(value & 0xffffffffn)));
  }
  // 6to4 (2002::/16): bits 80..111 embed an IPv4 address.
  if ((value >> 112n) === 0x2002n) {
    return isPrivateIPv4(intToIpv4(Number((value >> 80n) & 0xffffffffn)));
  }
  // Teredo (2001::/32) tunnels embed (obfuscated) private IPv4s; reject wholesale.
  if ((value >> 96n) === 0x20010000n) return true;
  // Documentation (2001:db8::/32).
  if ((value >> 96n) === 0x20010db8n) return true;
  // Unique local (fc00::/7): first 7 bits are 1111110 (0x7e).
  if ((value >> 121n) === 0x7en) return true;
  // Link local (fe80::/10): first 10 bits are 1111111010 (0x3fa).
  if ((value >> 118n) === 0x3fan) return true;
  // Site local (fec0::/10, deprecated and unroutable): first 10 bits are 1111111011 (0x3fb).
  if ((value >> 118n) === 0x3fbn) return true;
  // Multicast (ff00::/8).
  if ((value >> 120n) === 0xffn) return true;

  return false;
}

function isPrivateOrReservedAddress(address: string): boolean {
  return address.includes(":")
    ? isPrivateIPv6(address)
    : isPrivateIPv4(address);
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function hostnameHasSuspiciousSyntax(hostname: string): boolean {
  const normalized = stripIpv6Brackets(hostname).toLowerCase();

  if (!normalized) return true;
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized.endsWith(".local") || normalized.endsWith(".localdomain")) return true;
  if (normalized.endsWith(".internal") || normalized.endsWith(".home.arpa")) return true;
  if (!normalized.includes(".") && isIP(normalized) === 0) return true;
  if (/^\d+$/.test(normalized)) return true;

  return false;
}

function isAllowedPort(protocol: string, port: string): boolean {
  if (!port) return true;
  if (protocol === "http:") return port === "80";
  if (protocol === "https:") return port === "443";
  return false;
}

export function validateOutboundUrl(url: URL): string | null {
  const hostname = stripIpv6Brackets(url.hostname);

  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    return "Please use a full http:// or https:// URL (e.g. https://example.com).";
  }

  if (url.username || url.password) {
    return "Please remove any username or password from the URL (e.g. use https://example.com instead of https://user:pass@example.com).";
  }

  if (!isAllowedPort(url.protocol, url.port)) {
    return "Please use the standard web version of the site, without a custom port in the URL (e.g. use https://example.com instead of https://example.com:3000).";
  }

  if (hostnameHasSuspiciousSyntax(hostname)) {
    return "Please use a normal public website URL that anyone can open in their browser (e.g. https://example.com).";
  }

  if (isIP(hostname) !== 0 && isPrivateOrReservedAddress(hostname)) {
    return "Please use a public URL, not a local or private network address (e.g. use https://example.com instead of http://192.168.1.10).";
  }

  return null;
}

async function resolvePublicHostname(hostname: string): Promise<ResolvedAddress[] | null> {
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records || records.length === 0) return null;

    for (const record of records) {
      if (isPrivateOrReservedAddress(record.address)) return null;
    }

    return records.map((record) => ({
      address: record.address,
      family: record.family,
    }));
  } catch {
    return null;
  }
}

/** True only when the hostname parses AND resolves to public, non-reserved IPs (no DNS-to-internal bypass). */
export async function isPubliclyResolvable(hostname: string): Promise<boolean> {
  const resolved = await resolvePublicHostname(stripIpv6Brackets(hostname));
  return resolved !== null && resolved.length > 0;
}

export async function safeBufferRequest(url: URL, options?: SafeRequestOptions) {
  const resolved = await resolvePublicHostname(stripIpv6Brackets(url.hostname));
  if (!resolved || resolved.length === 0) {
    throw new Error("hostname_not_public");
  }

  const client = url.protocol === "https:" ? https : http;
  const method = options?.method ?? "GET";
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
  const timeout = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxBytes = options?.maxBytes ?? MAX_RESPONSE_BYTES;

  return await new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
    truncated?: boolean;
  }>((resolve, reject) => {
    let outerSettled = false;
    const safeResolve = (value: {
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
      truncated?: boolean;
    }) => {
      if (outerSettled) return;
      outerSettled = true;
      resolve(value);
    };
    const safeReject = (err: Error) => {
      if (outerSettled) return;
      outerSettled = true;
      reject(err);
    };
    const lookup: NonNullable<http.RequestOptions["lookup"]> = (
      _hostname,
      options,
      callback,
    ) => {
      const resolvedCallback = (typeof options === "function"
        ? options
        : callback) as LookupCallback | LookupAllCallback | undefined;

      if (!resolvedCallback) {
        throw new Error("lookup_callback_missing");
      }

      if (typeof options === "object" && options?.all) {
        (resolvedCallback as LookupAllCallback)(null, resolved);
        return;
      }

      const selected = resolved[0];
      if (!selected) {
        (resolvedCallback as LookupCallback)(new Error("hostname_not_public"), "", 0);
        return;
      }

      (resolvedCallback as LookupCallback)(null, selected.address, selected.family);
    };

    const req = client.request(
      url,
      {
        method,
        headers: {
          "User-Agent": userAgent,
          ...(options?.headers ?? {}),
        },
        timeout,
        lookup,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        let truncated = false;

        res.on("data", (chunk: Buffer) => {
          if (outerSettled) return;
          totalBytes += chunk.length;
          if (totalBytes > maxBytes) {
            truncated = true;
            req.destroy();
            safeResolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
              truncated: true,
            });
            return;
          }
          chunks.push(chunk);
        });

        res.on("end", () => {
          safeResolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            truncated,
          });
        });
      },
    );

    req.on("timeout", () => req.destroy(new Error("request_timeout")));
    req.on("error", safeReject);
    req.end();
  });
}

// Each hop is re-validated and re-pinned by safeBufferRequest; auth headers never cross origins.
export async function safeBufferRequestFollowingRedirects(url: URL, options?: SafeRequestOptions) {
  let current = url;
  let headers = options?.headers;
  for (let hop = 0; hop <= 3; hop++) { // max redirects followed
    const res = await safeBufferRequest(current, { ...options, headers });
    const location = res.headers.location;
    if (res.status < 300 || res.status >= 400 || !location) return res;
    const next = new URL(location, current);
    if (validateOutboundUrl(next)) throw new Error("redirect_not_public");
    if (next.origin !== current.origin) headers = undefined;
    current = next;
  }
  throw new Error("too_many_redirects");
}

export async function safeRequest(url: URL, options?: SafeRequestOptions) {
  const result = await safeBufferRequest(url, options);
  return {
    status: result.status,
    headers: result.headers,
    body: result.body.toString("utf8"),
  };
}
