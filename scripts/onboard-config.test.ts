import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertBucketName,
  assertEmailAddress,
  enableEmail,
  assertWorkerName,
  extractJson,
  isPlaceholderAuthSecret,
  normalizeAppUrl,
  parseEnvFile,
  patchWranglerProject,
  publicHostname,
  readWranglerProject,
  secretsForUpload,
  suggestSubdomain,
  workersDevUrl,
} from "./onboard-config.ts";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("reads the committed wrangler project", () => {
  const project = readWranglerProject(source);
  assert.equal(project.workerName, "chat");
  assert.equal(project.databaseName, "chat");
  assert.equal(project.databaseId, "");
  assert.equal(project.bucketName, "chat-uploads");
  assert.equal(project.queueName, "chat-background");
  assert.equal(project.appUrl, "");
  assert.equal(publicHostname(project.appUrl), null);
});

test("patches resource ids without dropping comments or other bindings", () => {
  const patched = patchWranglerProject(source, {
    workerName: "acme",
    databaseName: "acme-db",
    databaseId: "11111111-1111-4111-8111-111111111111",
    bucketName: "acme-uploads",
    queueName: "acme-jobs",
    appUrl: "https://acme.example",
    turnstileSiteKey: "0xSITE",
  });
  const project = readWranglerProject(patched);
  assert.equal(project.workerName, "acme");
  assert.equal(project.databaseName, "acme-db");
  assert.equal(project.databaseId, "11111111-1111-4111-8111-111111111111");
  assert.equal(project.bucketName, "acme-uploads");
  assert.equal(project.queueName, "acme-jobs");
  assert.equal(project.appUrl, "https://acme.example");
  assert.equal(project.turnstileSiteKey, "0xSITE");
  assert.equal(patched.match(/"queue": "acme-jobs"/g)?.length, 2);
  assert.match(patched, /"R2_BUCKET_NAME": "acme-uploads"/);
  assert.match(patched, /"name": "WORKSPACE_HUB"/);
  assert.match(patched, /"migrations_dir": "db\/migrations"/);
  assert.match(patched, /Leave empty in git/);
  assert.match(patched, /Hourly maintenance/);

  const again = patchWranglerProject(patched, { databaseId: "22222222-2222-4222-8222-222222222222" });
  assert.equal(readWranglerProject(again).databaseId, "22222222-2222-4222-8222-222222222222");
  assert.equal(again.match(/WORKSPACE_HUB/g)?.length, source.match(/WORKSPACE_HUB/g)?.length);
});

test("normalizes public URLs and hostnames", () => {
  assert.equal(normalizeAppUrl("https://chat.example.com/invite/"), "https://chat.example.com");
  assert.equal(publicHostname("https://chat.example.com"), "chat.example.com");
  assert.equal(publicHostname("http://localhost:5173"), null);
  assert.equal(workersDevUrl("Chat", "acme"), "https://chat.acme.workers.dev");
  assert.throws(() => normalizeAppUrl("chat.example.com"), /absolute http/);
  assert.throws(() => assertBucketName("Chat"), /lowercase/);
  assert.throws(() => assertWorkerName("my_chat"), /lowercase/);
  assertWorkerName("chat");
});

test("turns on email with a sender var and a send_email binding", () => {
  const enabled = enableEmail(source, "chat@example.com");
  assert.match(enabled, /"EMAIL_FROM": "chat@example.com"/);
  assert.match(enabled, /"send_email": \[\{ "name": "EMAIL" \}\],\n\s*"analytics_engine_datasets"/);
  assert.equal(enableEmail(enabled, "hi@example.com").match(/"send_email"/g)?.length, 1);
  const legacy = source.replace(/\s*\/\/ Optional\. Sender[^\n]*\n[^\n]*\n[^\n]*\n\s*"EMAIL_FROM": "",/, "");
  assert.doesNotMatch(legacy, /EMAIL_FROM/);
  assert.match(enableEmail(legacy, "chat@example.com"), /"vars": \{\n    "EMAIL_FROM": "chat@example.com",/);
  assert.throws(() => assertEmailAddress("chat"), /not an email/);
});

test("suggests a workers.dev subdomain", () => {
  assert.equal(suggestSubdomain("Walter Lim's Account", undefined), "walter-lim");
  assert.equal(suggestSubdomain(undefined, "Jo.Smith@example.com"), "jo-smith");
  assert.equal(suggestSubdomain("!!!", undefined), "my-chat");
});

test("builds a secret payload and rejects half-set pairs", () => {
  assert.equal(isPlaceholderAuthSecret("change-me-to-a-long-random-string"), true);
  const secrets = secretsForUpload({
    betterAuthSecret: "real-secret",
    accountId: "acct",
    turnstileSecret: "ts",
    githubId: "gh",
    githubSecret: "ghs",
  });
  assert.deepEqual(Object.keys(secrets).sort(), [
    "BETTER_AUTH_SECRET",
    "CLOUDFLARE_ACCOUNT_ID",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "TURNSTILE_SECRET_KEY",
  ]);
  // No secret supplied: the Worker generates its own, so nothing is uploaded.
  assert.equal(secretsForUpload({ accountId: "acct" }).BETTER_AUTH_SECRET, undefined);
  assert.equal(secretsForUpload({ betterAuthSecret: "change-me-to-a-long-random-string" }).BETTER_AUTH_SECRET, undefined);
  assert.throws(() => secretsForUpload({ betterAuthSecret: "x", googleId: "only-id" }), /GOOGLE_CLIENT_SECRET/);
});

test("parses env files and wrangler JSON with leading noise", () => {
  const env = parseEnvFile("# comment\nFOO=bar\nBAZ=\"qux\"\nEMPTY=\n");
  assert.deepEqual(env, { FOO: "bar", BAZ: "qux", EMPTY: "" });
  assert.deepEqual(extractJson("warning\n[{\"uuid\":\"u\",\"name\":\"chat\"}]\n"), [{ uuid: "u", name: "chat" }]);
  assert.deepEqual(extractJson('{"ok":true} trailing'), { ok: true });
});
