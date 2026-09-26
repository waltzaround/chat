/**
 * Download the database to a .sql file, or load one into a fresh database.
 *
 *   npm run backup                              # deployed database → backups/<time>.sql
 *   npm run restore -- backups/<file>.sql       # into an empty database
 *
 * The backup holds rows only. D1 cannot export a database that has full-text-search
 * tables, and a plain export drops indexes and inserts rows before the tables they
 * reference exist. So a restore first applies this repo's migrations to an empty
 * database (every table, index, trigger, and the search index, as the app expects),
 * then loads the rows; the search triggers index messages as they arrive.
 * Uploaded files in R2 are not included. For undoing a mistake in place, D1 Time
 * Travel is usually the better tool (see the README).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractJson } from "./onboard-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerBin = path.join(root, "node_modules", ".bin", "wrangler");
const MIGRATIONS = path.join(root, "db", "migrations");
const HEADER = "-- Beacon backup";

const HELP = `Back up or restore the database.

Usage:
  npm run backup                          Deployed database → backups/<time>.sql
  npm run backup -- --local               Local dev database
  npm run restore -- <file.sql>           Into the (empty) deployed database
  npm run restore -- <file.sql> --local   Into the (empty) local dev database

Options:
  --local              Use the local dev database
  --persist-to <dir>   With --local on restore, the state folder passed to wrangler dev --persist-to
  --account <id>       Cloudflare account, when your login has several
  --help               Show this help

Restoring only works into a database with no tables yet: create one with
npx wrangler d1 create <name>, put its id in wrangler.jsonc, then restore.
`;

interface Flags {
  command: "backup" | "restore";
  file?: string;
  local: boolean;
  persistTo?: string;
  account?: string;
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.command === "backup") backup(flags);
  else restore(flags);
}

function backup(flags: Flags): void {
  // d1_migrations is rebuilt by the restore's own migrations run.
  const tables = listTables(flags).filter((t) => t !== "d1_migrations");
  if (tables.length === 0) fail("The database has no tables to back up.");
  const [latest] = query<{ name: string }>("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1", flags);
  mkdirSync(path.join(root, "backups"), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const output = path.join("backups", `${flags.local ? "local" : "remote"}-${stamp}.sql`);
  wrangler(["d1", "export", "DB", location(flags), "--no-schema", "--output", output, ...tables.flatMap((t) => ["--table", t])], flags);
  const file = path.join(root, output);
  writeFileSync(file, `${HEADER} ${new Date().toISOString()}. Rows only; load with npm run restore.\n-- schema: ${latest?.name ?? "unknown"}\n${readFileSync(file, "utf8")}`);
  const size = (statSync(file).size / 1024).toFixed(0);
  console.log(`\nSaved ${tables.length} tables to ${output} (${size} KB).`);
  console.log("It holds password hashes and the server's auth secret: keep it private, and somewhere other than this computer.");
  console.log("Uploaded files (R2) are not included.");
}

function restore(flags: Flags): void {
  if (!flags.file) fail("Pass the backup file: npm run restore -- backups/<file>.sql");
  const file = path.resolve(flags.file);
  if (!existsSync(file)) fail(`No file at ${flags.file}.`);
  const text = readFileSync(file, "utf8");
  if (!text.startsWith(HEADER)) fail("That file was not made by npm run backup.");
  const schema = /^-- schema: (\S+)/m.exec(text)?.[1];
  const known = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
  if (schema && schema !== "unknown" && !known.includes(schema)) {
    fail(`The backup is from a newer version (${schema}). Update this copy (npm run update) first.`);
  }
  if (listTables(flags).length > 0) {
    fail("That database already has tables. Restore into a new, empty one: npx wrangler d1 create <name>, put its id in wrangler.jsonc as database_id, then run this again.");
  }

  console.log("Creating the tables…");
  wrangler(["d1", "migrations", "apply", "DB", location(flags), ...persist(flags)], flags);
  console.log("Loading the backup…");
  wrangler(["d1", "execute", "DB", location(flags), "--yes", "--file", file, ...persist(flags)], flags);
  console.log("\nRestored. Deploy to use it (npm run deploy), or run the app locally.");
}

/** Every real table except full-text-search tables, their shadow tables, and D1/SQLite internals. */
function listTables(flags: Flags): string[] {
  const rows = query<{ name: string; sql: string | null }>("SELECT name, sql FROM sqlite_master WHERE type = 'table'", flags);
  const virtual = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(r.sql ?? "")).map((r) => r.name);
  const shadow = (name: string) => virtual.some((v) => name.startsWith(`${v}_`));
  return rows
    .map((r) => r.name)
    .filter((name) => !virtual.includes(name) && !shadow(name) && !name.startsWith("sqlite_") && !name.startsWith("_cf_"));
}

function query<T>(command: string, flags: Flags): T[] {
  const result = wrangler(["d1", "execute", "DB", location(flags), "--json", "--command", command, ...persist(flags)], flags);
  return extractJson<Array<{ results?: T[] }>>(result)[0]?.results ?? [];
}

function location(flags: Flags): string {
  return flags.local ? "--local" : "--remote";
}

function persist(flags: Flags): string[] {
  return flags.local && flags.persistTo ? ["--persist-to", flags.persistTo] : [];
}

function wrangler(args: string[], flags: Flags): string {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" };
  if (flags.account) env.CLOUDFLARE_ACCOUNT_ID = flags.account;
  const result = spawnSync(wranglerBin, args, { cwd: root, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) fail(`wrangler ${args.slice(0, 2).join(" ")} failed.\n${(result.stderr || result.stdout).trim().split("\n").slice(-15).join("\n")}`);
  return result.stdout;
}

function parseArgs(argv: string[]): Flags {
  const [command, ...rest] = argv.filter((a) => a !== "--");
  if (command !== "backup" && command !== "restore") fail(HELP);
  const flags: Flags = { command, local: false };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token === "--help" || token === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (token === "--local") flags.local = true;
    else if (token === "--persist-to" || token === "--account") {
      const value = rest[++i];
      if (!value) fail(`${token} needs a value.`);
      if (token === "--persist-to") flags.persistTo = value;
      else flags.account = value;
    } else if (!token.startsWith("-") && command === "restore" && !flags.file) flags.file = token;
    else fail(`Unknown option "${token}". See --help.`);
  }
  return flags;
}

function fail(message: string): never {
  console.error(`\n${message}`);
  process.exit(1);
}

if (!existsSync(wranglerBin)) fail("Wrangler is not installed. Run npm install first.");
main();
