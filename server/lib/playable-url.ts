// Software demos must be a hosted site or compiled build, never a repo, source
// file or video. Hardware proof must be a public video (CAD-only: Printables).
import { parseRepositoryUrl } from "./github";
import { safeRequest, validateOutboundUrl } from "./outbound-url";
import type {
  PlayableUrlVerdict,
  UrlValidationCode,
} from "../types/url-validation";

// Long timeout + browser UA so demos behind anti-bot WAFs don't false-flag.
const PLAYABLE_PROBE_TIMEOUT_MS = 8000;
const PLAYABLE_PROBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// A raw source file is never a runnable software demo (the "bagel.cpp" fine).
const SOURCE_FILE_EXT =
  /\.(c|cc|cpp|cxx|h|hpp|hh|py|js|mjs|cjs|ts|tsx|jsx|java|go|rs|rb|php|cs|swift|kt|kts|m|mm|sh|bash|lua|pl|r|sql)$/i;
// Build proof for hardware; not a software demo.
const VIDEO_EXT = /\.(mov|mp4|avi|mkv|webm|m4v|wmv|flv)$/i;
// On a code host only a compiled release counts as a software demo.
const BUILD_EXT = /\.(exe|dmg|apk|ipa|jar|appimage|msi|deb|rpm|pkg)$/i;
const ARCHIVE_EXT = /\.(zip|tar|gz|tgz|rar|7z|bz2|xz)$/i;
// Free hosts that sleep idle projects; the shipping FAQ says these don't pass.
const SLEEP_HOSTS =
  /(^|\.)(onrender\.com|render\.com|repl\.co|replit\.app|replit\.dev|repl\.it|glitch\.me|cyclic\.app|cyclic\.sh|herokuapp\.com|pythonanywhere\.com|adaptable\.app|fly\.dev|deta\.dev|deno\.dev|koyeb\.app)$/i;

// A provider homepage is not a deployed project. Subdomains such as
// my-project.netlify.app remain valid; only the provider-owned root is blocked.
const HOSTING_SERVICE_HOME_HOSTS = new Set([
  "netlify.com",
  "www.netlify.com",
  "netlify.app",
  "vercel.com",
  "www.vercel.com",
  "vercel.app",
  "pages.dev",
  "github.io",
  "cloudflare.com",
  "www.cloudflare.com",
]);

const VIDEO_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "loom.com",
  "www.loom.com",
  "vimeo.com",
  "www.vimeo.com",
  "streamable.com",
  "reddit.com",
  "www.reddit.com",
  "v.redd.it",
  "app.slack.com",
  "files.slack.com",
]);

// Canonical CAD-only hardware proof. Allowed before the probe since Cloudflare
// makes it 403 our checker.
const PRINTABLES_HOSTS = new Set(["printables.com", "www.printables.com"]);

function isPrintables(url: URL): boolean {
  return PRINTABLES_HOSTS.has(url.hostname.toLowerCase());
}

export interface ValidatePlayableUrlOptions {
  projectType: "software" | "hardware";
  hardwareBuildProofRequired?: boolean;
  repositoryUrl?: string | null;
  skipNetwork?: boolean;
}

function verdict(
  severity: "block" | "warn",
  code: UrlValidationCode,
  message: string,
  checkedUrl: string,
  extra?: { httpStatus?: number; contentType?: string | null },
): PlayableUrlVerdict {
  return { ok: false, severity, code, message, checkedUrl, ...extra };
}

function normalizeForCompare(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\.git$/i, "").replace(/\/+$/g, "");
    return `${u.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return raw.trim().toLowerCase().replace(/\/+$/g, "");
  }
}

function isVideo(url: URL, lastSegment: string): boolean {
  return VIDEO_HOSTS.has(url.hostname.toLowerCase()) || VIDEO_EXT.test(lastSegment);
}

export async function validatePlayableUrl(
  rawUrl: string,
  opts: ValidatePlayableUrlOptions,
): Promise<PlayableUrlVerdict | null> {
  const isSoftware = opts.projectType !== "hardware";
  const trimmed = (rawUrl ?? "").trim();
  if (!trimmed) return null; // "missing demo" is handled by the policy layer.

  // 1. Parse + SSRF guard (hard block, both types).
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return verdict(
      "block",
      "invalid_demo_url",
      "Your playable URL isn't a valid web link. Paste a full https:// URL anyone can open in a browser (e.g. https://example.com).",
      trimmed,
    );
  }
  const ssrfError = validateOutboundUrl(url);
  if (ssrfError) {
    return verdict("block", "invalid_demo_url", ssrfError, trimmed);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? "";
  const parsedRepo = parseRepositoryUrl(trimmed);

  if (HOSTING_SERVICE_HOME_HOSTS.has(url.hostname.toLowerCase())) {
    return verdict(
      "block",
      "demo_url_is_host_homepage",
      "This is the hosting provider's website, not your deployed project. Paste your project's complete public URL (for example, your-project.netlify.app rather than netlify.com).",
      trimmed,
    );
  }

  // 2. Repository-as-playable. Software needs a deployment or compiled release;
  // hardware needs public video proof, not its source repository.
  if (parsedRepo != null) {
    if (!isSoftware) {
      if (VIDEO_EXT.test(lastSegment)) return null;
      return verdict(
        "block",
        opts.hardwareBuildProofRequired ? "hardware_demo_not_video" : "demo_url_is_repository",
        opts.hardwareBuildProofRequired
          ? "A hardware demo must be a public video showing the working build, not the source repository. Use YouTube, Loom, a public video file, Slack canvas, or Reddit. CAD-only projects may use a Printables page."
          : "Your hardware demo is the source repository, not a public render or animation. Link the actual design preview instead.",
        trimmed,
      );
    }
    // On a code host only a build asset or a /releases or /tags page is a demo.
    const isBuildAsset =
      /\/releases\/download\//i.test(url.pathname) ||
      BUILD_EXT.test(lastSegment) ||
      ARCHIVE_EXT.test(lastSegment);
    const isReleasePage = /\/(releases|tags)(\/|$)/i.test(url.pathname);
    if (!isBuildAsset && !isReleasePage) {
      return verdict(
        "block",
        "demo_url_is_repository",
        "Your playable URL is your code repository, not something people can try. Link a hosted demo (e.g. a deployed site) or a downloadable build/release. Software needs a hosted site or a compiled binary.",
        trimmed,
      );
    }
  } else if (
    isSoftware &&
    !!opts.repositoryUrl &&
    normalizeForCompare(trimmed) === normalizeForCompare(opts.repositoryUrl)
  ) {
    return verdict(
      "block",
      "demo_url_is_repository",
      "Your playable URL is your code repository, not something people can try. Link a hosted demo or a downloadable build/release.",
      trimmed,
    );
  }

  // 3. Video (software block, hardware allow). Before the file sniff because
  // video hosts have no file extension.
  if (isVideo(url, lastSegment)) {
    if (isSoftware) {
      return verdict(
        "block",
        "demo_url_is_file_download",
        "A video isn't a playable link for a software project. Link a hosted demo people can open, or a downloadable build/release (a compiled binary). Videos are only accepted for hardware builds.",
        trimmed,
      );
    }
    return null;
  }

  // 3b. Printables (hardware allow), skipping the probe it would fail.
  if (!isSoftware && isPrintables(url)) {
    return null;
  }

  if (SOURCE_FILE_EXT.test(lastSegment)) {
    if (isSoftware) {
      return verdict(
        "block",
        "demo_url_is_file_download",
        "Your playable URL points at a source file, not something people can run. Link a hosted demo or a downloadable build/release.",
        trimmed,
      );
    }
    return verdict(
      "warn",
      "demo_url_is_file_download",
      "Your playable URL points at a source file rather than a working demo. Double-check this is the link you meant.",
      trimmed,
    );
  }

  // 5. Sleep-on-wake hosts (Render/Replit/Glitch/…). Domain alone cannot prove
  // the project uses a sleeping free tier, so this remains acknowledgeable.
  if (SLEEP_HOSTS.test(url.hostname)) {
    return verdict(
      "warn",
      "demo_url_sleeps",
      "This host may put free projects to sleep. Confirm the link wakes successfully for reviewers, or use a host that stays available.",
      trimmed,
    );
  }

  if (opts.skipNetwork) return null;

  // 6. Reachability probe (network). Warn-class only: a momentary 404 or an
  // anti-bot 403 shouldn't hard-block a legitimate student.
  let probe: Awaited<ReturnType<typeof safeRequest>>;
  try {
    probe = await safeRequest(url, {
      method: "GET",
      userAgent: PLAYABLE_PROBE_USER_AGENT,
      timeoutMs: PLAYABLE_PROBE_TIMEOUT_MS,
    });
  } catch {
    return verdict(
      "warn",
      "demo_url_unreachable",
      "We couldn't open your playable URL (it timed out or didn't respond). Make sure it's live and publicly reachable before submitting.",
      trimmed,
    );
  }

  const status = probe.status;
  const contentType =
    (typeof probe.headers["content-type"] === "string"
      ? (probe.headers["content-type"] as string)
      : null) ?? null;

  // 7. A video behind a redirect/CDN still blocks software; other content types
  // are ignored to avoid false positives on misconfigured hosts.
  if (isSoftware && contentType && /^video\//i.test(contentType)) {
    return verdict(
      "block",
      "demo_url_is_file_download",
      "That link serves a video, not a hosted demo. Software needs a hosted site or a compiled binary/release, not a video.",
      trimmed,
      { httpStatus: status, contentType },
    );
  }

  if (!isSoftware && opts.hardwareBuildProofRequired && (!contentType || !/^video\//i.test(contentType))) {
    return verdict(
      "block",
      "hardware_demo_not_video",
      "A hardware demo must be a public video showing the working build. Use YouTube, Loom, a public video file, Slack canvas, or Reddit. CAD-only projects may use a Printables page.",
      trimmed,
      { httpStatus: status, contentType },
    );
  }

  if (status === 404) {
    return verdict(
      "warn",
      "demo_url_unreachable",
      "We got a 404 at your playable URL. Double-check it's the live link and not a deleted or moved page.",
      trimmed,
      { httpStatus: status, contentType },
    );
  }
  if (status === 401 || status === 403) {
    return verdict(
      "warn",
      "demo_url_unreachable",
      "Your playable URL blocked our check (it needs a login or refused the request). Make sure reviewers can open it without signing in.",
      trimmed,
      { httpStatus: status, contentType },
    );
  }
  if (status >= 500) {
    return verdict(
      "warn",
      "demo_url_unreachable",
      "Your playable URL returned a server error. Make sure the site is up and stable before submitting.",
      trimmed,
      { httpStatus: status, contentType },
    );
  }

  return null;
}

// Tutorial example text (mirrors app/utils/localizeTutorialHtml.ts); a match
// routes to manual review. No length cutoff: real minimal pages are as short.
