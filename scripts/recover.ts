/**
 * Locked out? Make a one-time password-reset link from the terminal.
 *
 *   npm run recover                          # the server owner, on the deployed server
 *   npm run recover -- --email sam@example.com
 *   npm run recover -- --local               # the local dev database
 *
 * Uses your Wrangler login, so it only works for someone who can manage the
 * Cloudflare account. Members who forget their password get a link from the
 * owner instead (User Settings → Server), or by email when email is set up.
 */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson, readWranglerProject, workersDevUrl } from "./onboard-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const LINK_TTL_MS = 24 * 60 * 60 * 1000;

const HELP = `Make a one-time password-reset link from the terminal.

Usage:
  npm run recover
  npm run recover -- --email sam@example.com
  npm run recover -- --local

Options:
  --email <address>  Account to reset (default: the server owner)
  --local            Use the local dev database instead of the deployed one
  --persist-to <dir> With --local, the state folder passed to wrangler dev --persist-to
  --url <origin>     Your server's address, if it cannot be worked out
  --account <id>     Cloudflare account, when your login has several
  --help             Show this help
`;

interface Flags {
  email?: string;
  local: boolean;
  url?: string;
  account?: string;
  persistTo?: string;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  const project = readWranglerProject(readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
  if (!flags.local && !project.databaseId) {
    fail("wrangler.jsonc has no database id, so this clone has not been set up with npm run setup. Run it from the folder you deployed from, or pass --local.");
  }

  const where = flags.email
    ? `SELECT id, email, display_name FROM users WHERE email = ${sql(flags.email.trim().toLowerCase())} COLLATE NOCASE`
    : "SELECT u.id, u.email, u.display_name FROM instance_settings s JOIN users u ON u.id = s.value WHERE s.key = 'owner_user_id'";
  const [user] = d1<{ id: string; email: string; display_name: string }>(where, flags);
  if (!user) fail(flags.email ? `No account uses ${flags.email}.` : "This server has no owner yet. Open the server and sign up; the first account becomes the owner.");

  const token = randomBytes(18).toString("base64url");
  const now = Date.now();
  // Same record Better Auth writes for a reset request, so the normal reset page accepts it.
  d1(
    `INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at) VALUES (${sql(randomUUID())}, ${sql(`reset-password:${token}`)}, ${sql(user.id)}, ${now + LINK_TTL_MS}, ${now}, ${now})`,
    flags,
  );

  const origin = flags.url?.replace(/\/+$/, "") ?? (flags.local ? "http://localhost:5173" : project.appUrl || deployedUrl(project.workerName, flags));
  const pathAndQuery = `/reset-password?token=${token}`;
  console.log(`\nReset link for ${user.display_name} (${user.email}). It works once, for 24 hours:\n`);
  console.log(`  ${origin ? `${origin}${pathAndQuery}` : pathAndQuery}\n`);
  if (!origin) console.log("Open it on your server's address (pass --url next time to print the full link).");
}

function d1<T>(command: string, flags: Flags): T[] {
  const args = ["d1", "execute", "DB", flags.local ? "--local" : "--remote", "--json", "--command", command];
  if (flags.local && flags.persistTo) args.push("--persist-to", flags.persistTo);
  const result = spawnSync(wranglerBin, args, { cwd: root, encoding: "utf8", env: wranglerEnv(flags) });
  if (result.status !== 0) fail(`wrangler d1 execute failed.\n${(result.stderr || result.stdout).trim().split("\n").slice(-15).join("\n")}`);
  const payload = extractJson<Array<{ results?: T[] }>>(result.stdout);
  return payload[0]?.results ?? [];
}

/** https://<worker>.<subdomain>.workers.dev, looked up with the Wrangler login. */
function deployedUrl(workerName: string, flags: Flags): string | null {
  try {
    const env = wranglerEnv(flags);
    const who = extractJson<{ accounts?: Array<{ id: string }> }>(spawnSync(wranglerBin, ["whoami", "--json"], { cwd: root, encoding: "utf8", env }).stdout);
    const accountId = flags.account ?? (who.accounts?.length === 1 ? who.accounts[0]!.id : undefined);
    const token = extractJson<{ token?: string }>(spawnSync(wranglerBin, ["auth", "token", "--json"], { cwd: root, encoding: "utf8", env }).stdout).token;
    if (!accountId || !token) return null;
    const curl = spawnSync("curl", ["-sf", "-H", `Authorization: Bearer ${token}`, `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`], { encoding: "utf8" });
    const subdomain = (JSON.parse(curl.stdout || "{}") as { result?: { subdomain?: string } }).result?.subdomain;
    return subdomain ? workersDevUrl(workerName, subdomain) : null;
  } catch {
    return null;
  }
}

function wranglerEnv(flags: Flags): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  if (flags.account) env.CLOUDFLARE_ACCOUNT_ID = flags.account;
  return env;
}

function sql(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { local: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") continue;
    if (token === "--help" || token === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (token === "--local") {
      flags.local = true;
      continue;
    }
    const [name, inline] = token.replace(/^--/, "").split("=", 2);
    const key = ({ email: "email", url: "url", account: "account", "persist-to": "persistTo" } as const)[name as string];
    if (key) {
      const value = inline ?? argv[++i];
      if (!value) fail(`--${name} needs a value.`);
      flags[key] = value;
      continue;
    }
    fail(`Unknown option "${token}". See --help.`);
  }
  return flags;
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

main();
