/**
 * Provision a Cloudflare deployment with Wrangler.
 *
 *   npm run setup
 *   npm run setup -- --yes --app-url https://chat.example.com --deploy
 *
 * Creates the D1 database, R2 bucket, and queue, writes the database id into
 * wrangler.jsonc (leave that change uncommitted), uploads secrets, and can deploy.
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
  extractJson,
  isPlaceholderAuthSecret,
  normalizeAppUrl,
  parseEnvFile,
  patchWranglerProject,
  publicHostname,
  readWranglerProject,
  secretsForUpload,
  workersDevUrl,
  type SecretSources,
  type WranglerPatch,
  type WranglerProject,
} from "./onboard-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "wrangler.jsonc");
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const tsxBin = path.join(root, "node_modules", ".bin", "tsx");

const HELP = `Set up a Cloudflare deployment with Wrangler.

Usage:
  npm run setup
  npm run setup -- --yes --app-url https://chat.example.com --deploy

The wizard logs in, creates the D1 database, R2 bucket, and queue, writes the
database id into wrangler.jsonc, sets the public URL, uploads secrets, and can
deploy. Run it again any time; resources that already exist are kept.

Leave the database id it writes uncommitted. A committed id would point every
deploy at this database.

Options:
  --yes                     Accept defaults. Secrets come from the environment
  --app-url <url>           Public origin stored in vars.APP_URL
  --name <worker>           Worker name
  --database <name>         D1 database name
  --bucket <name>           R2 bucket name
  --queue <name>            Queue name
  --account <id>            Cloudflare account, when the login has several
  --env-file <path>         KEY=VALUE file of secrets (values are not printed)
  --turnstile-site-key <k>  Use this Turnstile site key instead of creating one
  --deploy                  Build and deploy. With --yes, deploy only when this flag is set
  --no-deploy               Do not deploy
  --skip-migrations         Skip remote D1 migrations when not deploying
  --skip-secrets            Do not upload Worker secrets
  --skip-turnstile          Keep the current Turnstile site key
  --keep-auth-secret        Do not change BETTER_AUTH_SECRET
  --dry-run                 Print the plan and exit
  --help                    Show this help
`;

interface Flags {
  yes: boolean;
  dryRun: boolean;
  deploy: boolean;
  noDeploy: boolean;
  skipMigrations: boolean;
  skipSecrets: boolean;
  skipTurnstile: boolean;
  keepAuthSecret: boolean;
  help: boolean;
  appUrl?: string;
  name?: string;
  database?: string;
  bucket?: string;
  queue?: string;
  account?: string;
  envFile?: string;
  turnstileSiteKey?: string;
}

interface Answers {
  workerName: string;
  appUrl: string | null;
  databaseName: string;
  bucketName: string;
  queueName: string;
  accountId: string;
  turnstile: "create" | "test" | "provided";
  turnstileSiteKey?: string;
  turnstileSecret?: string;
  betterAuthSecret?: string;
  keepAuthSecret: boolean;
  skipSecrets: boolean;
  googleId?: string;
  googleSecret?: string;
  githubId?: string;
  githubSecret?: string;
  realtimeAppId?: string;
  realtimeToken?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  migrate: boolean;
  deploy: boolean;
  authSecretSource: "generate" | "environment" | "keep";
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
  if (flags.deploy && flags.noDeploy) throw new SetupError("Pass either --deploy or --no-deploy.");
  if (!exists(wranglerBin)) throw new SetupError("Wrangler is not installed. Run npm install in this repo.");

  const project = readWranglerProject(readFileSync(configPath, "utf8"));
  const envSecrets = loadEnvSecrets(flags.envFile);
  const nonInteractive = flags.yes || !stdin.isTTY;

  if (flags.dryRun) {
    const answers = await collectAnswers(flags, project, flags.account ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? "", null, envSecrets);
    printPlan(answers);
    console.log("\nDry run. wrangler.jsonc was not modified and no Cloudflare resources were created.");
    return;
  }

  if (!stdin.isTTY && !flags.yes) {
    throw new SetupError("No terminal attached. Re-run with --yes and the flags you need, or see --help.");
  }

  const who = await ensureLogin(flags);
  const accountId = await chooseAccount(who, flags, nonInteractive);
  const label = who.email ?? who.accounts?.find((account) => account.id === accountId)?.name ?? accountId;
  console.log(`Logged in${who.email ? ` as ${who.email}` : ""} (${label}).`);
  const suggested = await lookupWorkersDev(accountId, flags.name ?? project.workerName);
  const answers = await collectAnswers(flags, project, accountId, suggested, envSecrets);
  // Preflight secret pairs before anything is created.
  if (!answers.skipSecrets) secretsForUpload(secretInput(answers, answers.turnstile === "create" ? undefined : answers.turnstileSecret));
  printPlan(answers);
  if (!flags.yes && !(await confirm("Continue?", true))) {
    console.log("Stopped before creating anything.");
    return;
  }
  await execute(answers, nonInteractive);
}

async function execute(answers: Answers, nonInteractive: boolean): Promise<void> {
  const patch: WranglerPatch = {
    workerName: answers.workerName,
    databaseName: answers.databaseName,
    bucketName: answers.bucketName,
    queueName: answers.queueName,
  };
  if (answers.appUrl) patch.appUrl = answers.appUrl;
  updateConfig(patch);

  const databaseId = await ensureD1(answers);
  updateConfig({ databaseId });
  console.log("The D1 id is now in wrangler.jsonc. Leave that change uncommitted.");

  await ensureBucket(answers);
  await ensureQueue(answers);

  let appUrl = answers.appUrl;
  if (appUrl) await configureEdge(answers, appUrl);

  if (!answers.skipSecrets) await uploadSecrets(secretInput(answers, answers.turnstileSecret));
  await createPresets(answers);

  if (!answers.deploy && answers.migrate) await applyMigrations(answers.accountId);
  if (answers.deploy) await deployApp(answers, nonInteractive);

  if (!appUrl && answers.deploy) {
    appUrl = deployedUrl;
    if (appUrl) {
      console.log(`Using ${appUrl} as the public URL.`);
      updateConfig({ appUrl });
      const withUrl = { ...answers, appUrl };
      await configureEdge(withUrl, appUrl);
      if (!answers.skipSecrets && withUrl.turnstileSecret) {
        await uploadSecrets({ accountId: answers.accountId, keepAuthSecret: true, turnstileSecret: withUrl.turnstileSecret });
      }
      await deployApp(withUrl, nonInteractive);
    } else {
      console.log("Deploy finished without a workers.dev URL in the log. Set --app-url and run setup again so auth links and Turnstile use the public origin.");
    }
  }

  printNext(answers, appUrl);
}

let deployedUrl: string | null = null;

async function configureEdge(answers: Answers, appUrl: string): Promise<void> {
  const host = publicHostname(appUrl);
  if (!host) {
    console.log("Public URL is local, so R2 CORS and a Turnstile widget were left unchanged.");
    return;
  }
  await configureCors(answers.bucketName, appUrl, answers.accountId);
  if (answers.turnstile === "create") {
    const widget = await ensureTurnstile(answers.workerName, host, answers.accountId);
    answers.turnstileSiteKey = widget.sitekey;
    answers.turnstileSecret = widget.secret;
    updateConfig({ turnstileSiteKey: widget.sitekey });
    console.log(`Turnstile widget ${widget.name} (${widget.sitekey}).`);
  } else if (answers.turnstileSiteKey) {
    updateConfig({ turnstileSiteKey: answers.turnstileSiteKey });
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
  console.log(`Created D1 database ${answers.databaseName}.`);
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

async function ensureBucket(answers: Answers): Promise<void> {
  const info = await wrangler(["r2", "bucket", "info", answers.bucketName, "--json"], answers.accountId, { allowFailure: true, ci: true });
  if (info.code === 0) {
    console.log(`R2 bucket ${answers.bucketName} already exists.`);
    return;
  }
  const created = await wrangler(["r2", "bucket", "create", answers.bucketName], answers.accountId, { allowFailure: true, ci: true });
  if (created.code !== 0 && !/already exists/i.test(`${created.stderr}\n${created.stdout}`)) throw failed("r2 bucket create", created);
  console.log(created.code === 0 ? `Created R2 bucket ${answers.bucketName}.` : `R2 bucket ${answers.bucketName} already exists.`);
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

async function configureCors(bucket: string, origin: string, accountId: string): Promise<void> {
  const file = path.join(tmpdir(), `beacon-r2-cors-${process.pid}.json`);
  const body = {
    rules: [{ allowed: { origins: [origin], methods: ["PUT"], headers: ["Content-Type"] }, maxAgeSeconds: 3600 }],
  };
  writeFileSync(file, JSON.stringify(body, null, 2));
  try {
    await wrangler(["r2", "bucket", "cors", "set", bucket, "--file", file, "--force"], accountId, { ci: true });
    console.log(`R2 CORS allows PUT from ${origin}.`);
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

async function ensureTurnstile(workerName: string, hostname: string, accountId: string): Promise<TurnstileWidget> {
  const widgetName = `${workerName}-turnstile`;
  const listed = await wranglerJson<TurnstileWidget[]>(["turnstile", "widget", "list", "--json"], accountId);
  const existing = (Array.isArray(listed) ? listed : []).find((widget) => widget.name === widgetName);
  if (existing) {
    const domains = new Set(existing.domains ?? []);
    if (!domains.has(hostname)) {
      domains.add(hostname);
      await wrangler(["turnstile", "widget", "update", existing.sitekey, "--domain", [...domains].join(",")], accountId, { ci: true });
    }
    const full = await wranglerJson<TurnstileWidget>(["turnstile", "widget", "get", existing.sitekey, "--json"], accountId);
    if (!full.secret) throw new SetupError(`Turnstile widget ${widgetName} has no secret in \`wrangler turnstile widget get\` output.`);
    console.log(`Turnstile widget ${widgetName} already exists.`);
    return full;
  }
  const created = await wranglerJson<TurnstileWidget>(
    ["turnstile", "widget", "create", widgetName, "--domain", hostname, "--mode", "managed", "--json"],
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

async function deployApp(answers: Answers, nonInteractive: boolean): Promise<void> {
  if (answers.migrate) {
    const result = await run("npm", ["run", "deploy"], { inherit: false, ci: nonInteractive, accountId: answers.accountId, tee: true });
    if (result.code !== 0) throw new SetupError("Deploy failed.");
    deployedUrl = workersDevFromLog(`${result.stdout}\n${result.stderr}`, answers.workerName);
    return;
  }
  await run("npm", ["run", "build"], { inherit: true, ci: nonInteractive, accountId: answers.accountId });
  const result = await run(wranglerBin, ["deploy"], { inherit: false, ci: nonInteractive, accountId: answers.accountId, tee: true });
  if (result.code !== 0) throw new SetupError("Deploy failed.");
  deployedUrl = workersDevFromLog(`${result.stdout}\n${result.stderr}`, answers.workerName);
}

function workersDevFromLog(log: string, workerName: string): string | null {
  const matches = [...log.matchAll(/https:\/\/[a-z0-9][a-z0-9.-]*\.workers\.dev/gi)].map((match) => match[0]);
  const preferred = matches.find((url) => url.toLowerCase().startsWith(`https://${workerName.toLowerCase()}.`));
  return preferred ?? matches[0] ?? null;
}

function secretInput(answers: Answers, turnstileSecret: string | undefined): SecretSources {
  return {
    betterAuthSecret: answers.betterAuthSecret,
    keepAuthSecret: answers.keepAuthSecret,
    accountId: answers.accountId || undefined,
    turnstileSecret,
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
  const source = readFileSync(configPath, "utf8");
  const next = patchWranglerProject(source, patch);
  if (next !== source) writeFileSync(configPath, next);
}

async function collectAnswers(
  flags: Flags,
  project: WranglerProject,
  accountId: string,
  suggestedUrl: string | null,
  envSecrets: Record<string, string>,
): Promise<Answers> {
  const yes = flags.yes;
  const workerName = flags.name ?? (yes ? project.workerName : await ask("Worker name", project.workerName));
  const databaseName = flags.database ?? project.databaseName;
  const bucketName = flags.bucket ?? project.bucketName;
  const queueName = flags.queue ?? project.queueName;
  let names = { databaseName, bucketName, queueName };
  if (!yes && !flags.database && !flags.bucket && !flags.queue) {
    const keep = await confirm(`Use D1 "${databaseName}", R2 "${bucketName}", and queue "${queueName}"?`, true);
    if (!keep) {
      names = {
        databaseName: await ask("D1 database name", databaseName),
        bucketName: await ask("R2 bucket name", bucketName),
        queueName: await ask("Queue name", queueName),
      };
    }
  }
  assertBucketName(names.bucketName);

  let appUrl: string | null;
  if (flags.appUrl) appUrl = normalizeAppUrl(flags.appUrl);
  else if (yes) {
    if (publicHostname(project.appUrl)) appUrl = normalizeAppUrl(project.appUrl);
    else appUrl = suggestedUrl;
  } else {
    const fallback = publicHostname(project.appUrl) ? project.appUrl : (suggestedUrl ?? "");
    const entered = await ask("Public URL (blank uses the workers.dev URL printed by deploy)", fallback);
    appUrl = entered ? normalizeAppUrl(entered) : null;
  }

  const host = appUrl ? publicHostname(appUrl) : null;
  let turnstile: Answers["turnstile"] = "test";
  let turnstileSiteKey = flags.turnstileSiteKey ?? project.turnstileSiteKey;
  let turnstileSecret = blankToUndefined(envSecrets.TURNSTILE_SECRET_KEY);
  if (flags.skipTurnstile || (appUrl !== null && !host)) {
    turnstile = turnstileSiteKey === TEST_TURNSTILE_SITE_KEY ? "test" : "provided";
  } else if (flags.turnstileSiteKey) {
    turnstile = "provided";
    if (!turnstileSecret && turnstileSiteKey === TEST_TURNSTILE_SITE_KEY) turnstileSecret = TEST_TURNSTILE_SECRET;
  } else if (yes || appUrl === null) {
    turnstile = flags.skipTurnstile ? "test" : "create";
  } else {
    const create = await confirm(`Create a Turnstile widget for ${host}?`, true);
    if (create) turnstile = "create";
    else {
      turnstileSiteKey = await ask("Turnstile site key", project.turnstileSiteKey);
      turnstile = "provided";
      if (turnstileSiteKey === TEST_TURNSTILE_SITE_KEY) turnstileSecret = TEST_TURNSTILE_SECRET;
      else if (!turnstileSecret) turnstileSecret = blankToUndefined(await askSecret("Turnstile secret (blank leaves the current Worker secret)"));
    }
  }

  let googleId: string | undefined;
  let googleSecret: string | undefined;
  let githubId: string | undefined;
  let githubSecret: string | undefined;
  let realtimeAppId: string | undefined;
  let realtimeToken: string | undefined;
  let r2AccessKeyId: string | undefined;
  let r2SecretAccessKey: string | undefined;
  let betterAuthSecret: string | undefined;
  let keepAuthSecret = flags.keepAuthSecret;
  let authSecretSource: Answers["authSecretSource"] = keepAuthSecret ? "keep" : "generate";

  if (!flags.skipSecrets) {
    const google = await optionalPair(yes, "Google OAuth", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", envSecrets, "Google client id", "Google client secret");
    googleId = google?.id;
    googleSecret = google?.secret;
    const github = await optionalPair(yes, "GitHub OAuth", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", envSecrets, "GitHub client id", "GitHub client secret");
    githubId = github?.id;
    githubSecret = github?.secret;
    const voice = await optionalPair(yes, "RealtimeKit voice", "REALTIMEKIT_APP_ID", "CLOUDFLARE_REALTIME_API_TOKEN", envSecrets, "RealtimeKit app id", "RealtimeKit API token");
    realtimeAppId = voice?.id;
    realtimeToken = voice?.secret;
    const r2 = await optionalPair(yes, "direct-to-R2 uploads", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", envSecrets, "R2 access key id", "R2 secret access key");
    r2AccessKeyId = r2?.id;
    r2SecretAccessKey = r2?.secret;

    const fromEnv = envSecrets.BETTER_AUTH_SECRET;
    if (keepAuthSecret) authSecretSource = "keep";
    else if (!isPlaceholderAuthSecret(fromEnv)) {
      betterAuthSecret = fromEnv;
      authSecretSource = "environment";
    } else if (yes) {
      betterAuthSecret = randomBytes(32).toString("base64");
      authSecretSource = "generate";
    } else if (await confirm("Generate a new BETTER_AUTH_SECRET? Doing this again signs everyone out.", true)) {
      betterAuthSecret = randomBytes(32).toString("base64");
      authSecretSource = "generate";
    } else {
      keepAuthSecret = true;
      authSecretSource = "keep";
    }
  } else {
    keepAuthSecret = true;
    authSecretSource = "keep";
  }

  let deploy = false;
  if (flags.noDeploy) deploy = false;
  else if (flags.deploy) deploy = true;
  else if (yes) deploy = false;
  else deploy = await confirm("Build and deploy the Worker?", true);
  if (yes && !flags.dryRun && !appUrl && !deploy) {
    throw new SetupError("Pass --app-url, or pass --deploy so setup can read the workers.dev URL.");
  }

  if (turnstile === "create" && appUrl === null && !deploy) {
    turnstile = "test";
    console.log("Turnstile widget creation waits for a public URL. Pass --app-url or deploy.");
  }

  return {
    workerName,
    appUrl,
    databaseName: names.databaseName,
    bucketName: names.bucketName,
    queueName: names.queueName,
    accountId,
    turnstile,
    turnstileSiteKey: turnstile === "create" ? undefined : turnstileSiteKey,
    turnstileSecret: turnstile === "create" || turnstile === "test" ? undefined : turnstileSecret,
    betterAuthSecret,
    keepAuthSecret,
    skipSecrets: flags.skipSecrets,
    googleId,
    googleSecret,
    githubId,
    githubSecret,
    realtimeAppId,
    realtimeToken,
    r2AccessKeyId,
    r2SecretAccessKey,
    migrate: !flags.skipMigrations,
    deploy,
    authSecretSource,
  };
}

async function optionalPair(
  yes: boolean,
  label: string,
  idKey: string,
  secretKey: string,
  envSecrets: Record<string, string>,
  idPrompt: string,
  secretPrompt: string,
): Promise<{ id: string; secret: string } | undefined> {
  const id = blankToUndefined(envSecrets[idKey]);
  const secret = blankToUndefined(envSecrets[secretKey]);
  if (id && secret) {
    if (yes || (await confirm(`Use the ${label} credentials from the environment?`, true))) return { id, secret };
    return undefined;
  }
  if (id || secret) throw new SetupError(`${id ? idKey : secretKey} is set and ${id ? secretKey : idKey} is empty. Set both or neither.`);
  if (yes) return undefined;
  if (!(await confirm(`Configure ${label}?`, false))) return undefined;
  const enteredId = await ask(idPrompt);
  const enteredSecret = await askSecret(secretPrompt);
  if (!enteredId || !enteredSecret) throw new SetupError(`${label} needs both values.`);
  return { id: enteredId, secret: enteredSecret };
}

function printPlan(answers: Answers): void {
  const secrets = answers.skipSecrets ? [] : Object.keys(secretsForUpload(secretInput(answers, answers.turnstile === "provided" ? answers.turnstileSecret : undefined)));
  if (answers.turnstile === "create") secrets.push("TURNSTILE_SECRET_KEY");
  console.log("\nPlan");
  console.log(`  Worker     ${answers.workerName}`);
  console.log(`  URL        ${answers.appUrl ?? "(workers.dev URL from deploy)"}`);
  console.log(`  D1         ${answers.databaseName}`);
  console.log(`  R2         ${answers.bucketName}`);
  console.log(`  Queue      ${answers.queueName}`);
  console.log(`  Turnstile  ${answers.turnstile === "create" ? "create a widget" : answers.turnstile === "test" ? "test keys" : answers.turnstileSiteKey}`);
  console.log(`  Auth secret ${answers.authSecretSource === "generate" ? "generate a new one" : answers.authSecretSource === "environment" ? "use the environment value" : "leave the current one"}`);
  console.log(`  Secrets    ${secrets.length ? secrets.join(", ") : "(none)"}`);
  console.log(`  Voice      ${answers.realtimeAppId ? "create presets" : "skip"}`);
  console.log(`  Deploy     ${answers.deploy ? "yes" : "no"}`);
}

function printNext(answers: Answers, appUrl: string | null): void {
  console.log("\nSetup finished.");
  console.log("Leave the D1 database id in wrangler.jsonc uncommitted.");
  if (!answers.deploy) console.log("Deploy with npm run deploy.");
  if (appUrl && (answers.googleId || answers.githubId)) {
    console.log(`OAuth callbacks: ${appUrl}/api/auth/callback/google and ${appUrl}/api/auth/callback/github`);
  }
  if (!answers.realtimeAppId) console.log("Voice: create a RealtimeKit app, then re-run setup with REALTIMEKIT_APP_ID and CLOUDFLARE_REALTIME_API_TOKEN.");
  if (!answers.r2AccessKeyId) console.log("Uploads are accepted by the Worker. Add R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and re-run setup for direct browser uploads.");
  if (answers.turnstile === "test" && appUrl && publicHostname(appUrl)) {
    console.log("Turnstile is the always-pass test widget. Re-run setup to create a real widget for this domain.");
  }
}

async function ensureLogin(flags: Flags): Promise<Whoami> {
  const first = await wrangler(["whoami", "--json"], undefined, { allowFailure: true, ci: true });
  if (first.code === 0) return extractJson<Whoami>(first.stdout);
  if (flags.yes || !stdin.isTTY) throw new SetupError("Wrangler is not logged in. Run npx wrangler login, then npm run setup again.");
  console.log("Wrangler is not logged in.");
  if (!(await confirm("Log in to Cloudflare now?", true))) throw new SetupError("Login is required.");
  const login = await run(wranglerBin, ["login"], { inherit: true, ci: false });
  if (login.code !== 0) throw new SetupError("Login failed.");
  const second = await wrangler(["whoami", "--json"], undefined, { ci: true });
  return extractJson<Whoami>(second.stdout);
}

async function chooseAccount(who: Whoami, flags: Flags, nonInteractive: boolean): Promise<string> {
  const accounts = who.accounts ?? [];
  const wanted = flags.account ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (wanted) {
    const match = accounts.find((account) => account.id === wanted || account.name === wanted);
    if (accounts.length > 0 && !match) throw new SetupError(`Account "${wanted}" is not on this login.\n${formatAccounts(accounts)}`);
    return match?.id ?? wanted;
  }
  if (accounts.length === 1) return accounts[0]!.id;
  if (accounts.length === 0) throw new SetupError("This Wrangler login has no Cloudflare account.");
  if (nonInteractive) throw new SetupError(`This login has more than one account. Pass --account.\n${formatAccounts(accounts)}`);
  console.log(formatAccounts(accounts));
  const picked = Number(await ask("Account number", "1"));
  const account = accounts[picked - 1];
  if (!account) throw new SetupError("Pick an account number from the list.");
  return account.id;
}

function formatAccounts(accounts: Array<{ id: string; name: string }>): string {
  return accounts.map((account, index) => `  ${index + 1}. ${account.name}  ${account.id}`).join("\n");
}

async function lookupWorkersDev(accountId: string, workerName: string): Promise<string | null> {
  const tokenResult = await wrangler(["auth", "token", "--json"], accountId, { allowFailure: true, ci: true });
  if (tokenResult.code !== 0) return null;
  let token: string | undefined;
  try {
    token = extractJson<{ token?: string }>(tokenResult.stdout).token;
  } catch {
    return null;
  }
  if (!token) return null;
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: { subdomain?: string } };
    if (!body.result?.subdomain) return null;
    return workersDevUrl(workerName, body.result.subdomain);
  } catch {
    return null;
  }
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
};

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    yes: false,
    dryRun: false,
    deploy: false,
    noDeploy: false,
    skipMigrations: false,
    skipSecrets: false,
    skipTurnstile: false,
    keepAuthSecret: false,
    help: false,
  };
  const values: Record<string, keyof Flags> = {
    "app-url": "appUrl",
    name: "name",
    database: "database",
    bucket: "bucket",
    queue: "queue",
    account: "account",
    "env-file": "envFile",
    "turnstile-site-key": "turnstileSiteKey",
  };
  const bools: Record<string, keyof Flags> = {
    yes: "yes",
    "dry-run": "dryRun",
    deploy: "deploy",
    "no-deploy": "noDeploy",
    "skip-migrations": "skipMigrations",
    "skip-secrets": "skipSecrets",
    "skip-turnstile": "skipTurnstile",
    "keep-auth-secret": "keepAuthSecret",
    help: "help",
    h: "help",
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") continue;
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
  if (error instanceof SetupError) console.error(`\n${error.message}`);
  else console.error(error);
  process.exit(1);
});
