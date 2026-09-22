import { applyD1Migrations, env } from "cloudflare:test";

// Each test file gets a fresh isolated storage; bring the schema up to date.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
