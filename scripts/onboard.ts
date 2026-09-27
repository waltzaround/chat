/**
 * Deploy your own copy of the app to Cloudflare with Wrangler.
 *
 *   npm run setup
 *   npm run setup -- --yes
 *
 * Logs in (a Cloudflare account can be created from the login page), registers a
 * workers.dev subdomain if the account has none, creates the D1 database, R2
 * bucket, and queue, writes the database id into wrangler.jsonc (leave that
 * change uncommitted), and deploys. The Worker generates its own auth secret and
 * uses whatever URL it is served on, so nothing else is required. On a new server
 * it prints a one-time link for creating the owner account.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  TEST_TURNSTILE_SECRET,
  TEST_TURNSTILE_SITE_KEY,
  assertBucketName,
  assertEmailAddress,
  assertWorkerName,
  enableEmail,
  extractJson,
  normalizeAppUrl,
  parseEnvFile,
  patchWranglerProject,
  publicHostname,
  readWranglerProject,
  secretsForUpload,
  suggestSubdomain,
  workersDevUrl,
  type SecretSources,
  type WranglerPatch,
  type WranglerProject,
} from "./onboard-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "wrangler.jsonc");
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");

const HELP = `Deploy your own copy of this app to Cloudflare.

Usage:
  npm run setup
  npm run setup -- --yes

Logs in to Cloudflare (you can create a free account from the login page),
creates the D1 database, R2 bucket, and queue, and deploys. Run it again any
time: resources that already exist are kept, and it is how you add the
optional extras (Google/GitHub sign-in, voice, direct uploads, password-reset
email) later.

Password-reset email needs the Cloudflare Workers Paid plan ($5/month) and your
own domain on Cloudflare DNS. Without it, the server owner makes reset links
in User Settings → Server, and npm run recover covers the owner.

Leave the database id it writes to wrangler.jsonc uncommitted. A committed id
would point every deploy at this database.

Options:
  --yes                     Accept every default and do not prompt
  --name <worker>           Worker name (default: the name in wrangler.jsonc)
  --account <id>            Cloudflare account, when the login has several
  --subdomain <name>        workers.dev subdomain to register if the account has none
  --app-url <url>           Custom domain the Worker is also served on. Used for the
                            Turnstile widget and upload CORS, next to workers.dev
  --env-file <path>         KEY=VALUE file of optional secrets (values are not printed)
  --email-from <address>    Turn on password-reset email from this address
                            (Workers Paid plan and a domain on Cloudflare DNS)
  --database <name>         D1 database name
  --bucket <name>           R2 bucket name
  --queue <name>            Queue name
  --turnstile-site-key <k>  Use this Turnstile site key instead of creating a widget
  --skip-turnstile          Keep the current Turnstile site key
  --skip-secrets            Do not upload Worker secrets
  --no-deploy               Create resources and apply migrations, but do not deploy
  --skip-migrations         With --no-deploy, also skip remote D1 migrations
  --dry-run                 Print the plan and exit
  --help                    Show this help
`;

interface Flags {
  yes: boolean;
  dryRun: boolean;
  noDeploy: boolean;
  skipMigrations: boolean;
  skipSecrets: boolean;
  skipTurnstile: boolean;
  help: boolean;
  appUrl?: string;
  name?: string;
  database?: string;
  bucket?: string;
  queue?: string;
  account?: string;
  subdomain?: string;
  envFile?: string;
  emailFrom?: string;
  turnstileSiteKey?: string;
}

interface Answers {
  workerName: string;
  /** https://<worker>.<subdomain>.workers.dev, when the account's subdomain is known. */
  workersDevUrl: string | null;
  customUrl: string | null;
  databaseName: string;
  bucketName: string;
  queueName: string;
  accountId: string;
  turnstile: "create" | "test" | "provided";
  turnstileSiteKey?: string;
  turnstileSecret?: string;
  betterAuthSecret?: string;
  skipSecrets: boolean;
  googleId?: string;
  googleSecret?: string;
  githubId?: string;
  githubSecret?: string;
  realtimeAppId?: string;
  realtimeToken?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  /** Sender address for password-reset email. Needs the Workers Paid plan. */
  emailFrom?: string;
  migrate: boolean;
  deploy: boolean;
}

interface Whoami {
  email?: string;
  accounts?: Array<{ id: string; name: string }>;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

class SetupError extends Error {}

let currentChild: ChildProcess | undefined;

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    stdout.write(HELP);
    return;
  }
  if (!exists(wranglerBin)) throw new SetupError("Wrangler is not installed. Run npm install in this repo first.");

  const project = readWranglerProject(readFileSync(configPath, "utf8"));
  const envSecrets = loadEnvSecrets(flags.envFile);
  const interactive = !flags.yes && stdin.isTTY;

  if (flags.dryRun) {
    const answers = await collectAnswers(flags, project, flags.account ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "", null, envSecrets, false);
    printPlan(answers);
    console.log("\nDry run. wrangler.jsonc was not modified and no Cloudflare resources were created.");
    return;
  }
  if (!stdin.isTTY && !flags.yes) {
    throw new SetupError("No terminal attached. Re-run with --yes and the flags you need, or see --help.");
  }

  console.log("This deploys your own copy of the app to your Cloudflare account. It takes a couple of minutes.\n");
  const who = await ensureLogin(interactive);
  const accountId = await chooseAccount(who, flags, interactive);
  const account = who.accounts?.find((item) => item.id === accountId);
  console.log(`Logged in${who.email ? ` as ${who.email}` : ""} (${account?.name ?? accountId}).`);

  const subdomain = await ensureWorkersDev(accountId, suggestSubdomain(account?.name, who.email), flags, interactive);
  const answers = await collectAnswers(flags, project, accountId, subdomain, envSecrets, interactive);
  // Preflight secret pairs before anything is created.
  if (!answers.skipSecrets) secretsForUpload(secretInput(answers));
  printPlan(answers);
  if (interactive && !(await confirm("Continue?", true))) {
    console.log("Stopped before creating anything.");
    return;
  }
  await execute(answers, interactive);
}

async function execute(answers: Answers, interactive: boolean): Promise<void> {
  const patch: WranglerPatch = {
    workerName: answers.workerName,
    databaseName: answers.databaseName,
    bucketName: answers.bucketName,
    queueName: answers.queueName,
  };
  updateConfig(patch);
  if (answers.emailFrom) writeConfig(enableEmail(readFileSync(configPath, "utf8"), answers.emailFrom));

  const databaseId = await ensureD1(answers);
  updateConfig({ databaseId });

  await ensureBucket(answers, interactive);
  await ensureQueue(answers);
  await configureEdge(answers);
  await createPresets(answers);

  let claimUrl: string | null = null;
  if (answers.deploy) {
    const secrets = answers.skipSecrets ? {} : secretsForUpload(secretInput(answers));
    // Until someone signs up, the first account owns the server. Lock that to a link only
    // you get, so a stranger who finds the URL first cannot claim it.
    const url = answers.customUrl ?? answers.workersDevUrl;
    if (await needsOwner(url)) {
      secrets.OWNER_CLAIM_TOKEN = randomBytes(24).toString("base64url");
      claimUrl = `${url ?? `https://${answers.workerName}.<your-subdomain>.workers.dev`}/register?claim=${secrets.OWNER_CLAIM_TOKEN}`;
    }
    await deployApp(answers, interactive, secrets);
  } else {
    if (!answers.skipSecrets) await uploadSecrets(secretInput(answers));
    if (answers.migrate) await applyMigrations(answers.accountId);
  }

  printNext(answers, claimUrl);
}

/** False only when the deployed server confirms it already has an owner. */
async function needsOwner(url: string | null): Promise<boolean> {
  if (!url) return true;
  try {
    const response = await fetch(`${url}/api/auth-config`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return true;
    const body = (await response.json()) as { firstRun?: boolean };
    return body.firstRun !== false;
  } catch {
    return true;
  }
}

/** Public origins: workers.dev plus an optional custom domain. */
function publicOrigins(answers: Answers): string[] {
  return [answers.workersDevUrl, answers.customUrl].filter((url): url is string => !!url && !!publicHostname(url));
}

async function configureEdge(answers: Answers): Promise<void> {
  const origins = publicOrigins(answers);
  if (origins.length === 0) {
    console.log("Public URL is unknown, so the Turnstile widget and R2 CORS were skipped. Pass --app-url to set them up.");
    if (answers.turnstile === "create") answers.turnstile = "test";
    return;
  }
  await bestEffort("R2 CORS", () => configureCors(answers.bucketName, origins, answers.accountId));
  if (answers.turnstile === "create") {
    const hosts = origins.map((origin) => publicHostname(origin)!);
    const widget = await bestEffort("Turnstile", () => ensureTurnstile(answers.workerName, hosts, answers.accountId));
    if (widget) {
      answers.turnstileSiteKey = widget.sitekey;
      answers.turnstileSecret = widget.secret;
      updateConfig({ turnstileSiteKey: widget.sitekey });
      console.log(`Turnstile widget ${widget.name} protects sign-up.`);
    } else {
      answers.turnstile = "test";
    }
  } else if (answers.turnstileSiteKey) {
    updateConfig({ turnstileSiteKey: answers.turnstileSiteKey });
  }
}

/** Extras that should never stop a first deploy. */
async function bestEffort<T>(label: string, step: () => Promise<T>): Promise<T | undefined> {
  try {
    return await step();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${label} was skipped: ${message.split("\n")[0]}\nThe app works without it. Run setup again later to retry.`);
    return undefined;
  }
}

async function ensureWorkersDev(accountId: string, suggestion: string, flags: Flags, interactive: boolean): Promise<string | null> {
  const token = await apiToken(accountId);
  if (!token) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    const current = await fetch(url, { headers });
    const body = (await current.json()) as { result?: { subdomain?: string } | null };
    if (current.ok && body.result?.subdomain) return body.result.subdomain;
  } catch {
    return null;
  }

  // New accounts have no workers.dev subdomain until one is registered.
  console.log("\nThis account has no workers.dev subdomain yet. Your app will live at https://<worker>.<subdomain>.workers.dev.");
  let wanted = flags.subdomain ?? (interactive ? await ask("Pick a subdomain", suggestion) : suggestion);
  for (;;) {
    const response = await fetch(url, { method: "PUT", headers, body: JSON.stringify({ subdomain: wanted }) });
    const body = (await response.json().catch(() => ({}))) as { result?: { subdomain?: string }; errors?: Array<{ message: string }> };
    if (response.ok) {
      console.log(`Registered ${wanted}.workers.dev.`);
      return body.result?.subdomain ?? wanted;
    }
    const reason = body.errors?.map((error) => error.message).join("; ") || `HTTP ${response.status}`;
    if (!interactive) throw new SetupError(`Could not register the workers.dev subdomain "${wanted}": ${reason}. Pass a different --subdomain.`);
    console.log(`"${wanted}" is not available: ${reason}`);
    wanted = await ask("Try another subdomain");
    if (!wanted) throw new SetupError("A workers.dev subdomain is required.");
  }
}

async function ensureD1(answers: Answers): Promise<string> {
  const project = readWranglerProject(readFileSync(configPath, "utf8"));
  const remoteId = await findD1(answers.databaseName, answers.accountId);
  if (project.databaseId && remoteId && project.databaseId !== remoteId) {
    throw new SetupError(`wrangler.jsonc pins D1 ${project.databaseId}, but the database named ${answers.databaseName} is ${remoteId}. Clear database_id or pick the name of the database you want.`);
  }
  if (project.databaseId && !remoteId) {
    throw new SetupError(`wrangler.jsonc has database id ${project.databaseId}, and there is no D1 database named ${answers.databaseName} in this account. Clear database_id to create one, or set --database to the existing name.`);
  }
  if (remoteId) {
    console.log(`D1 database ${answers.databaseName} already exists.`);
    return remoteId;
  }
  const created = await wrangler(["d1", "create", answers.databaseName], answers.accountId, { allowFailure: true, ci: true });
  if (created.code !== 0 && !/already exists/i.test(`${created.stderr}\n${created.stdout}`)) {
    throw failed("d1 create", created);
  }
  const id = await findD1(answers.databaseName, answers.accountId);
  if (!id) throw new SetupError(`Created D1 database ${answers.databaseName}, then could not read its id.`);
  console.log(`Created D1 database ${answers.databaseName}. Its id is in wrangler.jsonc; leave that change uncommitted.`);
  return id;
}

async function findD1(name: string, accountId: string): Promise<string | undefined> {
  const payload = await wranglerJson<unknown>(["d1", "list", "--json"], accountId);
  const rows = Array.isArray(payload) ? payload : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { uuid?: string; name?: string };
    if (item.name === name && item.uuid && /^[0-9a-f-]{36}$/i.test(item.uuid)) return item.uuid;
  }
  return undefined;
}

async function ensureBucket(answers: Answers, interactive: boolean): Promise<void> {
  const info = await wrangler(["r2", "bucket", "info", answers.bucketName, "--json"], answers.accountId, { allowFailure: true, ci: true });
  if (info.code === 0) {
    console.log(`R2 bucket ${answers.bucketName} already exists.`);
    return;
  }
  for (;;) {
    const created = await wrangler(["r2", "bucket", "create", answers.bucketName], answers.accountId, { allowFailure: true, ci: true });
    const output = `${created.stderr}\n${created.stdout}`;
    if (created.code === 0 || /already exists/i.test(output)) {
      console.log(created.code === 0 ? `Created R2 bucket ${answers.bucketName}.` : `R2 bucket ${answers.bucketName} already exists.`);
      return;
    }
    // Fresh accounts have to switch R2 on once in the dashboard (the free tier asks for a payment method).
    if (!/10042|enable R2/i.test(output)) throw failed("r2 bucket create", created);
    const link = `https://dash.cloudflare.com/${answers.accountId}/r2/overview`;
    const message = `R2 (file storage) is not enabled on this account yet. Open ${link}, enable R2 (the free tier is enough), then`;
    if (!interactive) throw new SetupError(`${message} run setup again.`);
    await ask(`\n${message} press Enter to continue`);
  }
}

async function ensureQueue(answers: Answers): Promise<void> {
  const info = await wrangler(["queues", "info", answers.queueName], answers.accountId, { allowFailure: true, ci: true });
  if (info.code === 0) {
    console.log(`Queue ${answers.queueName} already exists.`);
    return;
  }
  const created = await wrangler(["queues", "create", answers.queueName], answers.accountId, { allowFailure: true, ci: true });
  if (created.code !== 0 && !/already exists/i.test(`${created.stderr}\n${created.stdout}`)) throw failed("queues create", created);
  console.log(created.code === 0 ? `Created queue ${answers.queueName}.` : `Queue ${answers.queueName} already exists.`);
}

async function configureCors(bucket: string, origins: string[], accountId: string): Promise<void> {
  const file = path.join(tmpdir(), `chat-r2-cors-${process.pid}.json`);
  const body = {
    rules: [{ allowed: { origins, methods: ["PUT"], headers: ["Content-Type"] }, maxAgeSeconds: 3600 }],
  };
  writeFileSync(file, JSON.stringify(body, null, 2));
  try {
    await wrangler(["r2", "bucket", "cors", "set", bucket, "--file", file, "--force"], accountId, { ci: true });
    console.log(`R2 CORS allows uploads from ${origins.join(", ")}.`);
  } finally {
    rmSync(file, { force: true });
  }
}

interface TurnstileWidget {
  name: string;
  sitekey: string;
  secret?: string;
  domains?: string[];
}

async function ensureTurnstile(workerName: string, hostnames: string[], accountId: string): Promise<TurnstileWidget> {
  const widgetName = `${workerName}-turnstile`;
  const listed = await wranglerJson<TurnstileWidget[]>(["turnstile", "widget", "list", "--json"], accountId);
  const existing = (Array.isArray(listed) ? listed : []).find((widget) => widget.name === widgetName);
  if (existing) {
    const domains = new Set(existing.domains ?? []);
    if (hostnames.some((host) => !domains.has(host))) {
      for (const host of hostnames) domains.add(host);
      await wrangler(["turnstile", "widget", "update", existing.sitekey, "--domain", [...domains].join(",")], accountId, { ci: true });
    }
    const full = await wranglerJson<TurnstileWidget>(["turnstile", "widget", "get", existing.sitekey, "--json"], accountId);
    if (!full.secret) throw new SetupError(`Turnstile widget ${widgetName} has no secret in \`wrangler turnstile widget get\` output.`);
    return full;
  }
  const created = await wranglerJson<TurnstileWidget>(
    ["turnstile", "widget", "create", widgetName, "--domain", hostnames.join(","), "--mode", "managed", "--json"],
    accountId,
  );
  if (!created.secret || !created.sitekey) throw new SetupError("Turnstile widget create did not return a site key and secret.");
  return { ...created, name: created.name || widgetName };
}

async function uploadSecrets(input: SecretSources): Promise<void> {
  const secrets = secretsForUpload(input);
  const names = Object.keys(secrets);
  if (names.length === 0) return;
  await wrangler(["secret", "bulk"], input.accountId, { ci: true, input: JSON.stringify(secrets) });
  console.log(`Uploaded secrets: ${names.join(", ")}.`);
}

async function createPresets(answers: Answers): Promise<void> {
  if (!answers.realtimeAppId || !answers.realtimeToken) return;
  const result = await run(tsxBin, [path.join(root, "scripts", "realtimekit-presets.ts")], {
    inherit: true,
    ci: true,
    accountId: answers.accountId,
    extraEnv: {
      REALTIMEKIT_APP_ID: answers.realtimeAppId,
      CLOUDFLARE_REALTIME_API_TOKEN: answers.realtimeToken,
    },
  });
  if (result.code !== 0) throw new SetupError("RealtimeKit preset setup failed.");
}

async function applyMigrations(accountId: string): Promise<void> {
  await wrangler(["d1", "migrations", "apply", "DB", "--remote"], accountId, { inherit: true, ci: true });
  console.log("Applied remote D1 migrations.");
}

/** Same steps as `npm run deploy`, with secrets shipped in the same version as the code. */
async function deployApp(answers: Answers, interactive: boolean, secrets: Record<string, string>): Promise<void> {
  console.log("\nBuilding and deploying…");
  const opts = { inherit: true, ci: !interactive, accountId: answers.accountId };
  const failure = "Deploy failed. The output above has the reason. Fix it and run setup again; finished steps are kept.";
  if ((await run("npm", ["run", "build"], opts)).code !== 0) throw new SetupError(failure);
  if (answers.migrate) await applyMigrations(answers.accountId);

  const names = Object.keys(secrets);
  const file = path.join(tmpdir(), `chat-secrets-${process.pid}.json`);
  const args = ["deploy"];
  if (names.length) {
    writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
    args.push("--secrets-file", file);
  }
  try {
    if ((await run(wranglerBin, args, opts)).code !== 0) {
      const hint = answers.emailFrom ? " If the error mentions send_email, password-reset email needs the Workers Paid plan and the sender's domain set up under Email → Email Sending." : "";
      throw new SetupError(failure + hint);
    }
  } finally {
    rmSync(file, { force: true });
  }
  const shown = names.filter((name) => name !== "OWNER_CLAIM_TOKEN");
  if (shown.length) console.log(`Uploaded secrets: ${shown.join(", ")}.`);
}

function secretInput(answers: Answers): SecretSources {
  return {
    betterAuthSecret: answers.betterAuthSecret,
    accountId: answers.accountId || undefined,
    turnstileSecret: answers.turnstile === "test" ? undefined : answers.turnstileSecret,
    googleId: answers.googleId,
    googleSecret: answers.googleSecret,
    githubId: answers.githubId,
    githubSecret: answers.githubSecret,
    realtimeAppId: answers.realtimeAppId,
    realtimeToken: answers.realtimeToken,
    r2AccessKeyId: answers.r2AccessKeyId,
    r2SecretAccessKey: answers.r2SecretAccessKey,
  };
}

function updateConfig(patch: WranglerPatch): void {
  writeConfig(patchWranglerProject(readFileSync(configPath, "utf8"), patch));
}

function writeConfig(next: string): void {
  if (next !== readFileSync(configPath, "utf8")) writeFileSync(configPath, next);
}

async function collectAnswers(
  flags: Flags,
  project: WranglerProject,
  accountId: string,
  subdomain: string | null,
  envSecrets: Record<string, string>,
  interactive: boolean,
): Promise<Answers> {
  const workerName = (flags.name ?? (interactive ? await ask("Worker name (part of your URL)", project.workerName) : project.workerName)).toLowerCase();
  assertWorkerName(workerName);
  const bucketName = flags.bucket ?? project.bucketName;
  assertBucketName(bucketName);

  const customUrl = flags.appUrl ? normalizeAppUrl(flags.appUrl) : null;

  let turnstile: Answers["turnstile"] = "create";
  let turnstileSiteKey: string | undefined;
  let turnstileSecret = blankToUndefined(envSecrets.TURNSTILE_SECRET_KEY);
  if (flags.turnstileSiteKey) {
    turnstile = "provided";
    turnstileSiteKey = flags.turnstileSiteKey;
    if (!turnstileSecret && turnstileSiteKey === TEST_TURNSTILE_SITE_KEY) turnstileSecret = TEST_TURNSTILE_SECRET;
  } else if (flags.skipTurnstile) {
    turnstile = project.turnstileSiteKey === TEST_TURNSTILE_SITE_KEY ? "test" : "provided";
  }

  const answers: Answers = {
    workerName,
    workersDevUrl: subdomain ? workersDevUrl(workerName, subdomain) : null,
    customUrl,
    databaseName: flags.database ?? project.databaseName,
    bucketName,
    queueName: flags.queue ?? project.queueName,
    accountId,
    turnstile,
    turnstileSiteKey,
    turnstileSecret,
    betterAuthSecret: blankToUndefined(envSecrets.BETTER_AUTH_SECRET),
    skipSecrets: flags.skipSecrets,
    migrate: !flags.skipMigrations,
    deploy: !flags.noDeploy,
  };
  if (flags.skipSecrets) return answers;

  // Extras are all optional. Values in the environment or --env-file are always used;
  // otherwise the wizard only asks about them when you opt in.
  const extras = interactive && (await confirm("\nSet up optional extras now? (Google/GitHub sign-in, voice and video, direct uploads)", false));
  const google = await optionalPair(extras, "Google sign-in", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", envSecrets, "Google client id", "Google client secret");
  const github = await optionalPair(extras, "GitHub sign-in", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", envSecrets, "GitHub client id", "GitHub client secret");
  const voice = await optionalPair(extras, "voice and video (RealtimeKit)", "REALTIMEKIT_APP_ID", "CLOUDFLARE_REALTIME_API_TOKEN", envSecrets, "RealtimeKit app id", "RealtimeKit API token");
  const r2 = await optionalPair(extras, "direct-to-R2 uploads", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", envSecrets, "R2 access key id", "R2 secret access key");
  let emailFrom = flags.emailFrom ?? blankToUndefined(envSecrets.EMAIL_FROM);
  if (!emailFrom && extras) {
    console.log("\nPassword-reset email lets members reset their own password. It needs the Cloudflare Workers Paid plan ($5/month)");
    console.log("and your own domain on Cloudflare DNS, set up under Email → Email Sending in the dashboard. Without it, you make reset links for people.");
    if (await confirm("Configure password-reset email?", false)) emailFrom = await ask("Send from (e.g. chat@yourdomain.com)");
  }
  if (emailFrom) assertEmailAddress(emailFrom);
  return {
    ...answers,
    googleId: google?.id,
    googleSecret: google?.secret,
    githubId: github?.id,
    githubSecret: github?.secret,
    realtimeAppId: voice?.id,
    realtimeToken: voice?.secret,
    r2AccessKeyId: r2?.id,
    r2SecretAccessKey: r2?.secret,
    emailFrom,
  };
}

async function optionalPair(
  prompt: boolean,
  label: string,
  idKey: string,
  secretKey: string,
  envSecrets: Record<string, string>,
  idPrompt: string,
  secretPrompt: string,
): Promise<{ id: string; secret: string } | undefined> {
  const id = blankToUndefined(envSecrets[idKey]);
  const secret = blankToUndefined(envSecrets[secretKey]);
  if (id && secret) return { id, secret };
  if (id || secret) throw new SetupError(`${id ? idKey : secretKey} is set and ${id ? secretKey : idKey} is empty. Set both or neither.`);
  if (!prompt || !(await confirm(`Configure ${label}?`, false))) return undefined;
  const enteredId = await ask(idPrompt);
  const enteredSecret = await askSecret(secretPrompt);
  if (!enteredId || !enteredSecret) throw new SetupError(`${label} needs both values.`);
  return { id: enteredId, secret: enteredSecret };
}

function printPlan(answers: Answers): void {
  const extras = [
    answers.googleId && "Google sign-in",
    answers.githubId && "GitHub sign-in",
    answers.realtimeAppId && "voice",
    answers.r2AccessKeyId && "direct uploads",
    answers.emailFrom && `password-reset email from ${answers.emailFrom} (Workers Paid plan)`,
  ].filter(Boolean);
  const turnstile = answers.turnstile === "create" ? "create a widget" : answers.turnstile === "test" ? "off (test keys)" : answers.turnstileSiteKey ?? "keep current";
  console.log("\nPlan");
  console.log(`  URL        ${answers.workersDevUrl ?? `https://${answers.workerName}.<your-subdomain>.workers.dev`}${answers.customUrl ? ` and ${answers.customUrl}` : ""}`);
  console.log(`  Resources  D1 "${answers.databaseName}", R2 "${answers.bucketName}", queue "${answers.queueName}" (kept if they exist)`);
  console.log(`  Turnstile  ${turnstile}`);
  console.log(`  Extras     ${extras.length ? extras.join(", ") : "none (add later by running setup again)"}`);
  console.log(`  Deploy     ${answers.deploy ? "yes" : "no"}`);
}

function printNext(answers: Answers, claimUrl: string | null): void {
  const url = answers.customUrl ?? answers.workersDevUrl;
  if (claimUrl) {
    console.log("\nDone. Your server is live. Open this link to create your owner account:\n");
    console.log(`  ${claimUrl}\n`);
    console.log("Only this link can create the first account; keep it to yourself. Afterwards the server is at");
    console.log(`${url ?? `https://${answers.workerName}.<your-subdomain>.workers.dev`} and new people join with invite links.`);
  } else if (answers.deploy) {
    console.log("\nDone. Your server is live at\n");
    console.log(`  ${url ?? `https://${answers.workerName}.<your-subdomain>.workers.dev`}\n`);
  } else {
    console.log("\nResources are ready. Deploy with npm run deploy.");
  }
  console.log("\nLeave the D1 database id in wrangler.jsonc uncommitted.");
  if (url && (answers.googleId || answers.githubId)) {
    console.log(`OAuth callback URLs: ${url}/api/auth/callback/google and ${url}/api/auth/callback/github`);
  }
  const missing = [
    !answers.googleId && !answers.githubId && "Google/GitHub sign-in",
    !answers.realtimeAppId && "voice and video",
    !answers.r2AccessKeyId && "direct uploads",
    !answers.emailFrom && "password-reset email (Workers Paid plan)",
  ].filter(Boolean);
  if (missing.length) console.log(`Optional: add ${missing.join(", ")} any time with npm run setup (answer yes to extras).`);
  if (!answers.emailFrom) {
    console.log("Forgotten passwords: make a reset link in User Settings → Server. Locked out yourself? Run npm run recover.");
  }
}

async function apiToken(accountId: string): Promise<string | null> {
  const result = await wrangler(["auth", "token", "--json"], accountId, { allowFailure: true, ci: true });
  if (result.code !== 0) return null;
  try {
    return extractJson<{ token?: string }>(result.stdout).token ?? null;
  } catch {
    return null;
  }
}

async function ensureLogin(interactive: boolean): Promise<Whoami> {
  const first = await wrangler(["whoami", "--json"], undefined, { allowFailure: true, ci: true });
  if (first.code === 0) return extractJson<Whoami>(first.stdout);
  if (!interactive) throw new SetupError("Wrangler is not logged in. Run npx wrangler login, then npm run setup again.");
  console.log("A browser window will open to log in to Cloudflare. No account yet? Choose Sign up there; the free plan is enough.");
  if (!(await confirm("Open it now?", true))) throw new SetupError("Login is required.");
  const login = await run(wranglerBin, ["login"], { inherit: true, ci: false });
  if (login.code !== 0) throw new SetupError("Login failed.");
  const second = await wrangler(["whoami", "--json"], undefined, { ci: true });
  return extractJson<Whoami>(second.stdout);
}

async function chooseAccount(who: Whoami, flags: Flags, interactive: boolean): Promise<string> {
  const accounts = who.accounts ?? [];
  const wanted = flags.account ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (wanted) {
    const match = accounts.find((account) => account.id === wanted || account.name === wanted);
    if (accounts.length > 0 && !match) throw new SetupError(`Account "${wanted}" is not on this login.\n${formatAccounts(accounts)}`);
    return match?.id ?? wanted;
  }
  if (accounts.length === 1) return accounts[0]!.id;
  if (accounts.length === 0) throw new SetupError("This Wrangler login has no Cloudflare account.");
  if (!interactive) throw new SetupError(`This login has more than one account. Pass --account.\n${formatAccounts(accounts)}`);
  console.log(formatAccounts(accounts));
  const picked = Number(await ask("Account number", "1"));
  const account = accounts[picked - 1];
  if (!account) throw new SetupError("Pick an account number from the list.");
  return account.id;
}

function formatAccounts(accounts: Array<{ id: string; name: string }>): string {
  return accounts.map((account, index) => `  ${index + 1}. ${account.name}  ${account.id}`).join("\n");
}

function loadEnvSecrets(envFile: string | undefined): Record<string, string> {
  const fromFile = envFile ? parseEnvFile(readFileSync(path.resolve(envFile), "utf8")) : {};
  const merged = { ...fromFile };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key in SECRET_ENV_KEYS) merged[key] = value;
  }
  return merged;
}

const SECRET_ENV_KEYS: Record<string, true> = {
  BETTER_AUTH_SECRET: true,
  GOOGLE_CLIENT_ID: true,
  GOOGLE_CLIENT_SECRET: true,
  GITHUB_CLIENT_ID: true,
  GITHUB_CLIENT_SECRET: true,
  TURNSTILE_SECRET_KEY: true,
  REALTIMEKIT_APP_ID: true,
  CLOUDFLARE_REALTIME_API_TOKEN: true,
  R2_ACCESS_KEY_ID: true,
  R2_SECRET_ACCESS_KEY: true,
  EMAIL_FROM: true,
};

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    yes: false,
    dryRun: false,
    noDeploy: false,
    skipMigrations: false,
    skipSecrets: false,
    skipTurnstile: false,
    help: false,
  };
  const values: Record<string, keyof Flags> = {
    "app-url": "appUrl",
    name: "name",
    database: "database",
    bucket: "bucket",
    queue: "queue",
    account: "account",
    subdomain: "subdomain",
    "email-from": "emailFrom",
    "env-file": "envFile",
    "turnstile-site-key": "turnstileSiteKey",
  };
  const bools: Record<string, keyof Flags> = {
    yes: "yes",
    "dry-run": "dryRun",
    "no-deploy": "noDeploy",
    "skip-migrations": "skipMigrations",
    "skip-secrets": "skipSecrets",
    "skip-turnstile": "skipTurnstile",
    help: "help",
    h: "help",
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--" || token === "--deploy") continue;
    const body = token.startsWith("--") ? token.slice(2) : token.startsWith("-") ? token.slice(1) : "";
    if (!body) throw new SetupError(`Unexpected argument "${token}". See --help.`);
    const [name, inline] = body.split("=", 2);
    if (!name) throw new SetupError(`Unexpected argument "${token}". See --help.`);
    if (name in bools) {
      if (inline !== undefined) throw new SetupError(`--${name} does not take a value.`);
      flags[bools[name]!] = true as never;
      continue;
    }
    if (name in values) {
      const value = inline ?? argv[++i];
      if (!value || value.startsWith("-")) throw new SetupError(`--${name} needs a value.`);
      flags[values[name]!] = value as never;
      continue;
    }
    throw new SetupError(`Unknown flag "--${name}". See --help.`);
  }
  return flags;
}

async function ask(label: string, fallback = ""): Promise<string> {
  if (!stdin.isTTY) throw new SetupError("No terminal attached. Re-run with --yes. See --help.");
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const hint = fallback ? ` [${fallback}]` : "";
    const answer = (await rl.question(`${label}${hint}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function confirm(label: string, fallback: boolean): Promise<boolean> {
  const answer = (await ask(label, fallback ? "Y/n" : "y/N")).toLowerCase();
  if (answer === "y/n") return true;
  if (answer === "y/N") return false;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return fallback;
}

function askSecret(label: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new SetupError(`Cannot prompt for ${label} without a terminal. Pass it with --env-file.`));
  }
  stdout.write(`${label} (hidden): `);
  return new Promise((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
    };
    const onData = (chunk: string) => {
      if (chunk === "\u0003") {
        cleanup();
        process.exit(130);
      }
      if (chunk === "\r" || chunk === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }
      if (chunk === "\u007f" || chunk === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (chunk.startsWith("\u001b")) return;
      value += chunk;
    };
    stdin.on("data", onData);
  });
}

interface RunOptions {
  inherit?: boolean;
  ci: boolean;
  accountId?: string;
  input?: string;
  extraEnv?: Record<string, string>;
  tee?: boolean;
}

function run(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: "false", ...opts.extraEnv };
    if (opts.ci) env.CI = "1";
    else delete env.CI;
    if (opts.accountId) env.CLOUDFLARE_ACCOUNT_ID = opts.accountId;
    const child = spawn(cmd, args, {
      cwd: root,
      env,
      stdio: opts.inherit ? "inherit" : ["pipe", "pipe", "pipe"],
    });
    currentChild = child;
    let out = "";
    let err = "";
    if (!opts.inherit) {
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        out += chunk;
        if (opts.tee) stdout.write(chunk);
      });
      child.stderr?.on("data", (chunk: string) => {
        err += chunk;
        if (opts.tee) process.stderr.write(chunk);
      });
      if (opts.input !== undefined) {
        child.stdin?.write(opts.input);
        child.stdin?.end();
      } else child.stdin?.end();
    }
    child.on("error", (error: NodeJS.ErrnoException) => {
      currentChild = undefined;
      if (error.code === "ENOENT") reject(new SetupError(`Could not run ${cmd}.`));
      else reject(error);
    });
    child.on("close", (code) => {
      currentChild = undefined;
      resolve({ code: code ?? 1, stdout: out, stderr: err });
    });
  });
}

interface WranglerOptions {
  allowFailure?: boolean;
  ci?: boolean;
  inherit?: boolean;
  input?: string;
}

async function wrangler(args: string[], accountId: string | undefined, opts: WranglerOptions = {}): Promise<RunResult> {
  const result = await run(wranglerBin, args, {
    inherit: opts.inherit,
    ci: opts.ci ?? true,
    accountId,
    input: opts.input,
  });
  if (result.code !== 0 && !opts.allowFailure) throw failed(args.join(" "), result);
  return result;
}

async function wranglerJson<T>(args: string[], accountId: string): Promise<T> {
  const result = await wrangler(args, accountId, { ci: true });
  try {
    return extractJson<T>(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SetupError(`${message}\n${tail(result.stderr)}`);
  }
}

function failed(command: string, result: RunResult): SetupError {
  return new SetupError(`wrangler ${command} failed.\n${tail(`${result.stderr}\n${result.stdout}`)}`);
}

function tail(text: string, lines = 40): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

function exists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

process.on("SIGINT", () => {
  if (stdin.isTTY) stdin.setRawMode(false);
  currentChild?.kill("SIGINT");
  console.log("\nAborted.");
  process.exit(130);
});

main().catch((error: unknown) => {
  // Validation and Wrangler failures are self-explanatory; DEBUG=1 shows the stack.
  if (error instanceof Error && !process.env.DEBUG) console.error(`\n${error.message}`);
  else console.error(error);
  process.exit(1);
});
