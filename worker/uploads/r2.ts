import { AwsClient } from "aws4fetch";
import type { Env } from "../env";

export const UPLOAD_URL_TTL_SECONDS = 10 * 60;

/** Presigned PUT lets the browser upload straight to the private bucket. */
export function canPresign(env: Env): boolean {
  return !!(env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.CLOUDFLARE_ACCOUNT_ID && env.R2_BUCKET_NAME);
}

export async function presignPut(env: Env, key: string, contentType: string): Promise<{ url: string; headers: Record<string, string> }> {
  const client = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });
  const url = new URL(`https://${env.R2_BUCKET_NAME}.${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeKey(key)}`);
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_URL_TTL_SECONDS));
  const signed = await client.sign(new Request(url, { method: "PUT", headers: { "Content-Type": contentType } }), { aws: { signQuery: true } });
  return { url: signed.url, headers: { "Content-Type": contentType } };
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

const ALLOWED_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "heic",
  "mp4", "webm", "mov", "m4v",
  "mp3", "wav", "ogg", "m4a", "flac", "aac",
  "pdf", "txt", "md", "csv", "json", "log", "yaml", "yml", "xml",
  "zip", "gz", "tar", "7z", "rar",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf",
  "ts", "tsx", "js", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "sh", "sql", "html", "css",
  "ttf", "otf", "woff", "woff2", "psd", "ai", "sketch", "fig",
]);

const BLOCKED_EXTENSIONS = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "pif", "dll", "jar", "vbs", "ps1", "app", "dmg", "apk"]);

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\-() ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "file";
}

export function validateFilename(filename: string): { ok: true; ext: string } | { ok: false; reason: string } {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, reason: "That file type is not allowed" };
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) return { ok: false, reason: "That file type is not supported" };
  return { ok: true, ext };
}

/**
 * Sniffs the real content type from the first bytes of the object. Returns
 * null when the type cannot be determined (caller falls back to a safe type).
 */
export function sniffMimeType(bytes: Uint8Array): string | null {
  const hex = (n: number) => [...bytes.slice(0, n)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const ascii = (start: number, len: number) => String.fromCharCode(...bytes.slice(start, start + len));
  if (hex(8) === "89504e470d0a1a0a") return "image/png";
  if (hex(3) === "ffd8ff") return "image/jpeg";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftypavif") return "image/avif";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand.startsWith("qt")) return "video/quicktime";
    if (brand === "M4A ") return "audio/mp4";
    return "video/mp4";
  }
  if (hex(4) === "1a45dfa3") return "video/webm";
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (hex(4) === "504b0304") return "application/zip";
  return null;
}

export function isInlineType(mime: string): boolean {
  return mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/") || mime === "application/pdf" || mime.startsWith("text/");
}

/** Types that browsers may execute as HTML/scripts must never be served inline. */
export function safeServeType(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes("html") || lower.includes("javascript") || lower.includes("xml") || lower === "image/svg+xml") return "application/octet-stream";
  return lower;
}
