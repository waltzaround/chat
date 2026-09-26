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

/**
 * Turns on password-reset email: sets vars.EMAIL_FROM and adds the send_email
 * binding. Older configs without an EMAIL_FROM var get one.
 */
export function enableEmail(source: string, from: string): string {
  let next = fieldPattern("EMAIL_FROM").test(source)
    ? replaceStringField(source, "EMAIL_FROM", from, "all")
    : source.replace(/("vars"\s*:\s*\{)/, `$1\n    "EMAIL_FROM": ${JSON.stringify(from)},`);
  if (!/"send_email"\s*:/.test(next)) {
    const binding = `  // Password-reset email (Workers Paid plan). Added by npm run setup.\n  "send_email": [{ "name": "EMAIL" }],\n`;
    next = next.replace(/(\n)(\s*"analytics_engine_datasets"\s*:)/, `$1${binding}$2`);
    if (!/"send_email"\s*:/.test(next)) throw new Error("Could not add the send_email binding to wrangler.jsonc.");
  }
  return next;
}

/**
 * For `npm run update`: take upstream's wrangler.jsonc and put this deployment's own
 * values back (names, database id, public URL, Turnstile key, email).
 */
export function carryOverDeployment(local: string, upstream: string): string {
  const mine = readWranglerProject(local);
  let next = patchWranglerProject(upstream, {
    workerName: mine.workerName,
    databaseName: mine.databaseName,
    databaseId: mine.databaseId,
    bucketName: mine.bucketName,
    queueName: mine.queueName,
    // A leftover localhost value would pin a live deployment to localhost; blank auto-detects.
    appUrl: mine.appUrl && publicHostname(mine.appUrl) ? mine.appUrl : "",
    turnstileSiteKey: mine.turnstileSiteKey,
  });
  const emailFrom = fieldPattern("EMAIL_FROM").exec(local)?.[1];
  if (emailFrom && /"send_email"\s*:/.test(local)) next = enableEmail(next, JSON.parse(`"${emailFrom}"`) as string);
  return next;
}

export function assertEmailAddress(value: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`"${value}" is not an email address.`);
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
  if (!appUrl) return null;
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

export function assertWorkerName(name: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) {
    throw new Error(`Worker name "${name}" must be 1–63 characters: lowercase letters, numbers, and hyphens, and must not start or end with a hyphen.`);
  }
}

/** A workers.dev subdomain guess from the account name or login email. */
export function suggestSubdomain(accountName: string | undefined, email: string | undefined): string {
  const base = (accountName ?? "").replace(/'s account$/i, "") || email?.split("@")[0] || "";
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "my-chat";
}

export interface SecretSources {
  /** Only uploaded when set. Without it the Worker generates and stores its own. */
  betterAuthSecret?: string;
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
  if (!isPlaceholderAuthSecret(input.betterAuthSecret)) secrets.BETTER_AUTH_SECRET = input.betterAuthSecret!.trim();
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
