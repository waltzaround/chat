import { applyD1Migrations, env } from "cloudflare:test";

// Each test file gets a fresh isolated storage; bring the schema up to date.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// A new server turns invite-only when its first account signs up. Most tests sign up
// many strangers, so start open; test/instance.test.ts covers the invite-only path.
await env.DB.prepare("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('registration', 'open')").run();
