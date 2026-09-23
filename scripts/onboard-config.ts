/**
 * Pure helpers for `npm run setup`. Wrangler.jsonc is JSONC, so edits are
 * surgical string replacements that keep comments and unrelated bindings.
 */

export const TEST_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
export const TEST_TURNSTILE_SECRET = "1x0000000000000000000000000000000AA";

const AUTH_SECRET_PLACEHOLDERS = new Set(["", "change-me", "change-me-to-a-long-random-string"]);

export interface WranglerProject {
  workerName: string;
  databaseName: string;
  databaseId: string;
  bucketName: string;
  queueName: string;
  appUrl: string;
  turnstileSiteKey: string;
}

export interface WranglerPatch {
  workerName?: string;
  databaseName?: string;
  databaseId?: string;
  bucketName?: string;
  queueName?: string;
  appUrl?: string;
  turnstileSiteKey?: string;
}

export function readWranglerProject(source: string): WranglerProject {
  return {
    workerName: readStringField(source, "name"),
    databaseName: readStringField(source, "database_name"),
    databaseId: readStringField(source, "database_id"),
    bucketName: readStringField(source, "bucket_name"),
    queueName: readStringField(source, "queue"),
    appUrl: readStringField(source, "APP_URL"),
    turnstileSiteKey: readStringField(source, "TURNSTILE_SITE_KEY"),
  };
}

export function patchWranglerProject(source: string, patch: WranglerPatch): string {
  let next = source;
  if (patch.workerName !== undefined) next = replaceStringField(next, "name", patch.workerName, "first");
  if (patch.databaseName !== undefined) next = replaceStringField(next, "database_name", patch.databaseName, "all");
  if (patch.databaseId !== undefined) next = replaceStringField(next, "database_id", patch.databaseId, "all");
  if (patch.bucketName !== undefined) {
    next = replaceStringField(next, "bucket_name", patch.bucketName, "all");
    next = replaceStringField(next, "R2_BUCKET_NAME", patch.bucketName, "all");
  }
  if (patch.queueName !== undefined) next = replaceStringField(next, "queue", patch.queueName, "all");
  if (patch.appUrl !== undefined) next = replaceStringField(next, "APP_URL", patch.appUrl, "all");
  if (patch.turnstileSiteKey !== undefined) next = replaceStringField(next, "TURNSTILE_SITE_KEY", patch.turnstileSiteKey, "all");
  return next;
}

export function normalizeAppUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Public URL must be an absolute http(s) URL. Received "${input}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Public URL must be http or https. Received "${input}".`);
  }
  return url.origin;
}

/** Hostname Turnstile and browsers can use. Local origins are omitted. */
export function publicHostname(appUrl: string): string | null {
  const url = new URL(appUrl);
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) return null;
  return host;
}

export function assertBucketName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name)) {
    throw new Error(`R2 bucket name "${name}" must be 3–63 characters: lowercase letters, numbers, and hyphens, and must not start or end with a hyphen.`);
  }
}

export function isPlaceholderAuthSecret(value: string | undefined): boolean {
  return value === undefined || AUTH_SECRET_PLACEHOLDERS.has(value.trim());
}

export interface SecretSources {
  betterAuthSecret?: string;
  keepAuthSecret?: boolean;
  accountId?: string;
  turnstileSecret?: string;
  googleId?: string;
  googleSecret?: string;
  githubId?: string;
  githubSecret?: string;
  realtimeAppId?: string;
  realtimeToken?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
}

export function secretsForUpload(input: SecretSources): Record<string, string> {
  const secrets: Record<string, string> = {};
  if (!input.keepAuthSecret) {
    if (isPlaceholderAuthSecret(input.betterAuthSecret)) {
      throw new Error("BETTER_AUTH_SECRET is missing. Generate one, or pass --keep-auth-secret to leave the current Worker secret in place.");
    }
    secrets.BETTER_AUTH_SECRET = input.betterAuthSecret!.trim();
  }
  if (input.accountId) secrets.CLOUDFLARE_ACCOUNT_ID = input.accountId;
  if (input.turnstileSecret) secrets.TURNSTILE_SECRET_KEY = input.turnstileSecret;
  addPair(secrets, "GOOGLE_CLIENT_ID", input.googleId, "GOOGLE_CLIENT_SECRET", input.googleSecret);
  addPair(secrets, "GITHUB_CLIENT_ID", input.githubId, "GITHUB_CLIENT_SECRET", input.githubSecret);
  addPair(secrets, "REALTIMEKIT_APP_ID", input.realtimeAppId, "CLOUDFLARE_REALTIME_API_TOKEN", input.realtimeToken);
  addPair(secrets, "R2_ACCESS_KEY_ID", input.r2AccessKeyId, "R2_SECRET_ACCESS_KEY", input.r2SecretAccessKey);
  return secrets;
}

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function extractJson<T>(stdout: string): T {
  const start = stdout.search(/[\[{]/);
  if (start < 0) throw new Error("Wrangler did not return JSON.");
  const text = stdout.slice(start);
  try {
    return JSON.parse(text) as T;
  } catch {
    // Wrangler sometimes prints a warning after the JSON document.
  }
  const open = text[0];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(0, i + 1)) as T;
    }
  }
  throw new Error("Wrangler returned incomplete JSON.");
}

export function workersDevUrl(workerName: string, subdomain: string): string {
  return `https://${workerName.toLowerCase()}.${subdomain}.workers.dev`;
}

function addPair(secrets: Record<string, string>, leftKey: string, left: string | undefined, rightKey: string, right: string | undefined): void {
  const l = left?.trim() ?? "";
  const r = right?.trim() ?? "";
  if (!l && !r) return;
  if (!l || !r) {
    const missing = l ? rightKey : leftKey;
    const present = l ? leftKey : rightKey;
    throw new Error(`${present} is set, and ${missing} is empty. Set both or neither.`);
  }
  secrets[leftKey] = l;
  secrets[rightKey] = r;
}

function readStringField(source: string, key: string): string {
  const match = fieldPattern(key).exec(source);
  if (!match) throw new Error(`wrangler.jsonc has no "${key}" string.`);
  return JSON.parse(`"${match[1]}"`) as string;
}

function replaceStringField(source: string, key: string, value: string, which: "all" | "first"): string {
  const pattern = new RegExp(`("${key}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`, "g");
  let seen = 0;
  const next = source.replace(pattern, (match, prefix: string) => {
    seen += 1;
    if (which === "first" && seen > 1) return match;
    return `${prefix}${JSON.stringify(value)}`;
  });
  if (seen === 0) throw new Error(`wrangler.jsonc has no "${key}" string.`);
  return next;
}

function fieldPattern(key: string): RegExp {
  return new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
}
