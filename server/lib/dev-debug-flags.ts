import type { H3Event } from "h3";
import { DEV_FAKE_HACKATIME_TOKEN } from "./dev-fake-hackatime";

const DEV_DEBUG_FLAGS_COOKIE = "macondo_dev_debug_flags";

export const DEV_DEBUG_FLAG_KEYS = [
  "ignoreAddressChecks",
  "ignoreShipPolicies",
  "ignoreEditPolicies",
  "ignoreReviewerOwnershipPolicies",
  "fakeHackatime",
] as const;

export type DevDebugFlagKey = (typeof DEV_DEBUG_FLAG_KEYS)[number];

export type DevDebugFlags = Record<DevDebugFlagKey, boolean>;

export const defaultDevDebugFlags: DevDebugFlags = {
  ignoreAddressChecks: false,
  ignoreShipPolicies: false,
  ignoreEditPolicies: false,
  ignoreReviewerOwnershipPolicies: false,
  fakeHackatime: false,
};

const DEV_DEBUG_FLAG_ALIASES: Record<DevDebugFlagKey, string[]> = {
  ignoreAddressChecks: ["ignoreAddressChecks", "ignore_address_checks", "address"],
  ignoreShipPolicies: ["ignoreShipPolicies", "ignore_ship_policies", "ship"],
  ignoreEditPolicies: ["ignoreEditPolicies", "ignore_edit_policies", "edit"],
  ignoreReviewerOwnershipPolicies: [
    "ignoreReviewerOwnershipPolicies",
    "ignore_reviewer_ownership_policies",
    "reviewOwnership",
    "review_ownership",
  ],
  fakeHackatime: [
    "fakeHackatime",
    "fake_hackatime",
    "fakeHackatimeLinked",
    "hackatime",
  ],
};

export function isDevDebugAvailable() {
  return process.env.NODE_ENV === "development" && process.env.MACONDO_DEV_TOOLS_ENABLED === "1";
}

function isSecureCookie(event: H3Event) {
  return process.env.NODE_ENV === "production" || getRequestURL(event).protocol === "https:";
}

function cloneDefaultFlags(): DevDebugFlags {
  return { ...defaultDevDebugFlags };
}

function decodeFlagsCookie(rawValue: string | null | undefined): unknown {
  if (!rawValue) return null;

  try {
    return JSON.parse(Buffer.from(rawValue, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function encodeFlagsCookie(flags: DevDebugFlags) {
  return Buffer.from(JSON.stringify(flags), "utf8").toString("base64url");
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeDevDebugFlags(
  input: unknown,
  fallback: DevDebugFlags = defaultDevDebugFlags,
): DevDebugFlags {
  const source = objectRecord(input);
  const next: DevDebugFlags = { ...fallback };

  if (!source) return next;

  for (const key of DEV_DEBUG_FLAG_KEYS) {
    for (const alias of DEV_DEBUG_FLAG_ALIASES[key]) {
      const rawValue = source[alias];
      if (typeof rawValue === "boolean") {
        next[key] = rawValue;
        break;
      }
    }
  }

  return next;
}

export function mergeDevDebugFlags(
  current: DevDebugFlags,
  patch: unknown,
): DevDebugFlags {
  return normalizeDevDebugFlags(objectRecord(patch), current);
}

export function getDevDebugFlags(event: H3Event): DevDebugFlags {
  if (!isDevDebugAvailable()) return cloneDefaultFlags();

  return normalizeDevDebugFlags(
    decodeFlagsCookie(getCookie(event, DEV_DEBUG_FLAGS_COOKIE)),
  );
}

export function anyDevDebugFlagsEnabled(flags: DevDebugFlags) {
  return DEV_DEBUG_FLAG_KEYS.some((key) => flags[key]);
}

export function setDevDebugFlags(event: H3Event, flags: DevDebugFlags) {
  if (!isDevDebugAvailable()) {
    throw createError({
      statusCode: 404,
      statusMessage: "Not found",
    });
  }

  const normalized = normalizeDevDebugFlags(flags);

  if (!anyDevDebugFlagsEnabled(normalized)) {
    deleteCookie(event, DEV_DEBUG_FLAGS_COOKIE, { path: "/" });
    return normalized;
  }

  setCookie(event, DEV_DEBUG_FLAGS_COOKIE, encodeFlagsCookie(normalized), {
    httpOnly: true,
    secure: isSecureCookie(event),
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // one week in seconds
  });

  return normalized;
}

export function getEffectiveHackatimeOAuthToken(
  event: H3Event,
  accessToken: string | null | undefined,
) {
  if (accessToken) return accessToken;
  return getDevDebugFlags(event).fakeHackatime
    ? DEV_FAKE_HACKATIME_TOKEN
    : null;
}
