// Kept here so callers can share it without importing the validator's runtime deps.

export type UrlValidationSeverity = "block" | "warn";

export type UrlValidationCode =
  // unparseable or rejected by the SSRF guard
  | "invalid_demo_url"
  // only a warn because of anti-bot 403s and momentary 404s
  | "demo_url_unreachable"
  | "demo_url_is_repository"
  // videos are still valid build proof for hardware
  | "demo_url_is_file_download"
  // free tiers that sleep when idle are often down when a reviewer opens them
  | "demo_url_sleeps"
  | "demo_url_is_host_homepage"
  // a Printables page also counts for CAD
  | "hardware_demo_not_video";

export interface PlayableUrlVerdict {
  ok: boolean;
  severity: UrlValidationSeverity;
  code: UrlValidationCode;
  message: string;
  checkedUrl: string;
  httpStatus?: number;
  contentType?: string | null;
}
