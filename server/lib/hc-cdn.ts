import { useRuntimeConfig } from "#imports";
import { HC_CDN_URL } from "./api-urls";

const ALLOWED_MIME_PREFIXES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/zip",
  "application/x-zip-compressed",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

const DISALLOWED_MIME = [
  "application/x-msdownload",
  "application/x-executable",
  "application/x-sh",
  "application/vnd.microsoft.portable-executable",
];

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// readMultipartFormData buffers uploads in memory, so the video cap stays conservative.
export const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;

export function maxBytesForMime(mime: string): number {
  return mime.toLowerCase().startsWith("video/")
    ? MAX_VIDEO_UPLOAD_BYTES
    : MAX_UPLOAD_BYTES;
}

export function isAllowedMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  if (DISALLOWED_MIME.includes(lower)) return false;
  if (ALLOWED_MIME_PREFIXES.some((m) => lower === m || lower.startsWith(m + ";"))) return true;
  return false;
}

// --- Magic-byte sniffing -----------------------------------------------------
// isAllowedMime trusts the client-declared Content-Type, so a polyglot (HTML or
// a script smuggled as image/png) could otherwise ride onto the CDN. These
// checks are defense in depth on top of the separate-origin CDN.

function hasPrefix(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((b, i) => bytes[offset + i] === b);
}

function hasAsciiPrefix(bytes: Uint8Array, ascii: string, offset = 0): boolean {
  return hasPrefix(bytes, Array.from(ascii, (c) => c.charCodeAt(0)), offset);
}

/** Best-effort sniff of the byte-level family, or null when unrecognized. */
function sniffMimeFamily(bytes: Uint8Array): string | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasAsciiPrefix(bytes, "GIF87a") || hasAsciiPrefix(bytes, "GIF89a")) return "image/gif";
  if (hasAsciiPrefix(bytes, "RIFF") && hasAsciiPrefix(bytes, "WEBP", 8)) return "image/webp";
  if (hasAsciiPrefix(bytes, "%PDF-")) return "application/pdf";
  if (hasAsciiPrefix(bytes, "PK", 0) && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) return "application/zip";
  if (hasAsciiPrefix(bytes, "ftyp", 4)) return "video/mp4"; // mp4/mov share the ISO-BMFF box
  if (hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (looksLikeText(bytes)) {
    const head = Buffer.from(bytes.slice(0, 1024)).toString("utf8").toLowerCase();
    if (head.includes("<svg")) return "image/svg+xml";
    return "text/plain";
  }
  return null;
}

function looksLikeText(bytes: Uint8Array): boolean {
  // NUL bytes (or other control chars outside \t\r\n) mean binary content.
  const scan = Math.min(bytes.length, 4096);
  for (let i = 0; i < scan; i++) {
    const b = bytes[i]!;
    if (b === 0 || (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d)) return false;
  }
  return true;
}

/**
 * True when the sniffed byte-level family is consistent with the declared
 * MIME type. Text types (text/plain, text/markdown) must be actual text;
 * images/videos/pdfs/zips must match their magic bytes; SVG may be either
 * sniffed-SVG or text (SVG is text to begin with).
 */
export function verifyUploadMime(declaredMime: string, bytes: Uint8Array): boolean {
  const declared = declaredMime.toLowerCase().split(";")[0]!.trim();
  const sniffed = sniffMimeFamily(bytes);
  if (sniffed === null) return false;

  if (declared === "image/png") return sniffed === "image/png";
  if (declared === "image/jpeg") return sniffed === "image/jpeg";
  if (declared === "image/gif") return sniffed === "image/gif";
  if (declared === "image/webp") return sniffed === "image/webp";
  if (declared === "image/svg+xml") return sniffed === "image/svg+xml" || sniffed === "text/plain";
  if (declared === "application/pdf") return sniffed === "application/pdf";
  if (declared === "application/zip" || declared === "application/x-zip-compressed") return sniffed === "application/zip";
  if (declared === "video/mp4" || declared === "video/quicktime") return sniffed === "video/mp4";
  if (declared === "video/webm") return sniffed === "video/webm";
  if (declared === "text/plain" || declared === "text/markdown") return sniffed === "text/plain";
  // Unknown declared type: at minimum require recognized bytes.
  return sniffed !== null;
}

export type UploadResult = { url: string; sha?: string } | { error: string };

export async function uploadBuffer(
  buffer: Uint8Array | ArrayBuffer,
  filename: string,
  mime: string,
): Promise<UploadResult> {
  const config = useRuntimeConfig();
  const cdnKey = config.hackclubCdnKey as string | undefined;
  if (!cdnKey) return { error: "HACKCLUB_CDN_KEY not configured" };

  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  const cap = maxBytesForMime(mime);
  if (bytes.byteLength > cap) {
    return { error: `file too large (max ${cap} bytes)` };
  }
  if (!isAllowedMime(mime)) {
    return { error: `mime type not allowed: ${mime}` };
  }
  // Central magic-byte gate: every upload path (image upload, support
  // uploads, fallout media rehost) funnels through here.
  if (!verifyUploadMime(mime, bytes)) {
    return { error: `file contents do not match the declared type: ${mime}` };
  }

  const slice = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const form = new FormData();
  form.append("file", new Blob([slice], { type: mime }), filename);

  try {
    const res = await fetch(`${HC_CDN_URL}/api/v4/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cdnKey}` },
      body: form,
    });

    if (!res.ok) {
      return { error: `cdn ${res.status}: ${(await res.text().catch(() => "<no body>")).slice(0, 500)}` };
    }

    const json = (await res.json()) as {
      url?: string;
      deployedUrl?: string;
      sha?: string;
      file?: string;
    };
    const url = json.deployedUrl || json.url || json.file;
    if (!url) return { error: "cdn response missing url" };
    return { url, sha: json.sha };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
