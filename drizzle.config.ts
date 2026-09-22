import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  // Only used by `drizzle-kit push/studio` against a remote database.
  // Migrations are applied with `wrangler d1 migrations apply` (see package.json).
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_D1_DATABASE_ID ?? "",
    token: process.env.CLOUDFLARE_D1_TOKEN ?? "",
  },
});
