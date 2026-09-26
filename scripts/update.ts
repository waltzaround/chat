/**
 * Bring this copy up to date with the upstream repo.
 *
 *   npm run update
 *
 * - In a git clone of upstream: `git pull --autostash`, which keeps the uncommitted
 *   database id that npm run setup wrote.
 * - In a copy made by the Deploy to Cloudflare button (no shared history): downloads
 *   upstream and lays it over this copy, keeping this deployment's own wrangler.jsonc
 *   values and deleting files upstream removed. .github/workflows/update-from-upstream.yml
 *   runs this weekly and opens a pull request.
 *
 * Runs on plain Node 22 (`node --experimental-strip-types`), so CI needs no npm install.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { carryOverDeployment } from "./onboard-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = ".beacon-upstream.json";
const DEFAULT_REPO = "waltzaround/beacon";

const HELP = `Bring this copy up to date with upstream.

Usage:
  npm run update
  npm run update -- --ref main

Options:
  --repo <owner/name>  Upstream GitHub repo (default: ${DEFAULT_REPO}, or UPSTREAM_REPO)
  --ref <branch>       Upstream branch (default: main)
  --from <dir>         Use a local checkout as upstream instead of downloading
  --force              Update even with uncommitted changes (they may be overwritten)
  --help               Show this help
`;

interface Flags {
  repo: string;
  ref: string;
  from?: string;
  force: boolean;
}

interface Manifest {
  repo: string;
  commit: string;
  files: string[];
}

function main(): void {
  const flags = parseArgs(process.argv.slice(2));

  const remote = !flags.from ? upstreamRemote(flags.repo) : null;
  if (remote) {
    console.log(`This is a clone of ${flags.repo}. Pulling ${remote}/${flags.ref}…`);
    const pulled = spawnSync("git", ["pull", "--autostash", remote, flags.ref], { cwd: root, stdio: "inherit" });
    if (pulled.status !== 0) fail("git pull failed. Resolve it, then run npm run update again.");
    printNext();
    return;
  }

  const dirty = git(["status", "--porcelain"]).trim();
  if (dirty && !flags.force) fail(`You have uncommitted changes. Commit or stash them first (or pass --force):\n${dirty}`);

  const previous = readManifest();
  const upstream = flags.from ? fromLocal(flags.from) : download(flags.repo, flags.ref, previous?.commit);
  if (!upstream) {
    console.log(`Already up to date with ${flags.repo}@${previous!.commit.slice(0, 7)}.`);
    return;
  }

  for (const file of upstream.files) {
    if (file === MANIFEST) continue;
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    if (file === "wrangler.jsonc" && existsSync(target)) {
      writeFileSync(target, carryOverDeployment(readFileSync(target, "utf8"), readFileSync(path.join(upstream.dir, file), "utf8")));
    } else {
      cpSync(path.join(upstream.dir, file), target);
    }
  }

  // Files the last update brought in that upstream has since deleted.
  const current = new Set(upstream.files);
  const removed = (previous?.files ?? []).filter((file) => !current.has(file) && existsSync(path.join(root, file)));
  for (const file of removed) rmSync(path.join(root, file));

  const manifest: Manifest = { repo: flags.repo, commit: upstream.commit, files: upstream.files.filter((f) => f !== MANIFEST).sort() };
  writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  upstream.cleanup();

  const changed = git(["status", "--porcelain"]).trim().split("\n").filter(Boolean);
  console.log(`Updated to ${flags.repo}@${upstream.commit.slice(0, 7)}: ${changed.length} files changed${removed.length ? `, ${removed.length} removed` : ""}.`);
  if (!previous) console.log("First update: files you deleted from your copy were restored, and nothing was removed.");
  if (changed.some((line) => line.endsWith("package.json"))) console.log("package.json changed: run npm install.");
  printNext();
}

function printNext(): void {
  console.log("\nNext: review the changes (git diff), commit, and deploy.");
  console.log("Deploy-button copies redeploy when the change reaches your default branch. From a clone, run npm run deploy.");
  console.log("Database migrations run as part of the deploy.");
}

/** The git remote that points at the upstream repo, if this is a clone of it. */
function upstreamRemote(repo: string): string | null {
  const remotes = spawnSync("git", ["remote", "-v"], { cwd: root, encoding: "utf8" }).stdout ?? "";
  const pattern = new RegExp(`github\\.com[:/]${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\.git)?\\s`, "i");
  const line = remotes.split("\n").find((l) => pattern.test(`${l} `));
  if (!line) return null;
  // A remote only counts when the histories are shared (deploy-button copies can add one too).
  const name = line.split(/\s+/)[0]!;
  spawnSync("git", ["fetch", "--quiet", name], { cwd: root });
  const base = spawnSync("git", ["merge-base", "HEAD", `${name}/HEAD`], { cwd: root, encoding: "utf8" });
  const fallback = base.status === 0 ? base : spawnSync("git", ["merge-base", "HEAD", `${name}/main`], { cwd: root, encoding: "utf8" });
  return fallback.status === 0 ? name : null;
}

interface Upstream {
  dir: string;
  commit: string;
  files: string[];
  cleanup: () => void;
}

function download(repo: string, ref: string, currentCommit: string | undefined): Upstream | null {
  const listed = execFileSync("git", ["ls-remote", `https://github.com/${repo}.git`, `refs/heads/${ref}`], { encoding: "utf8" }).trim();
  const commit = listed.split(/\s+/)[0];
  if (!commit) fail(`${repo} has no branch named ${ref}.`);
  if (commit === currentCommit) return null;

  // A shallow clone uses your git credentials, so a private upstream works too.
  const work = mkdtempSync(path.join(tmpdir(), "beacon-update-"));
  const dir = path.join(work, "src");
  const cloned = spawnSync("git", ["clone", "--quiet", "--depth", "1", "--branch", ref, `https://github.com/${repo}.git`, dir], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  if (cloned.status !== 0) fail(`Could not download ${repo}@${ref}.\n${cloned.stderr.trim()}`);
  const files = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const cloneCommit = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { dir, commit: cloneCommit, files, cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

function fromLocal(dir: string): Upstream {
  const abs = path.resolve(dir);
  const files = execFileSync("git", ["-C", abs, "ls-files"], { encoding: "utf8" }).split("\n").filter((f) => f && existsSync(path.join(abs, f)));
  const commit = execFileSync("git", ["-C", abs, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { dir: abs, commit, files, cleanup: () => {} };
}

function readManifest(): Manifest | null {
  const file = path.join(root, MANIFEST);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Manifest) : null;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { repo: process.env.UPSTREAM_REPO || DEFAULT_REPO, ref: "main", force: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") continue;
    if (token === "--help" || token === "-h") {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (token === "--force") {
      flags.force = true;
      continue;
    }
    const [name, inline] = token.replace(/^--/, "").split("=", 2);
    if (name === "repo" || name === "ref" || name === "from") {
      const value = inline ?? argv[++i];
      if (!value) fail(`--${name} needs a value.`);
      flags[name] = value;
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
