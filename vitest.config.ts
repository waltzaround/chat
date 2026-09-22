import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "db/migrations"));
  return {
    resolve: {
      alias: {
        "@shared": path.resolve(__dirname, "./shared"),
        "@db": path.resolve(__dirname, "./db"),
      },
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-1234",
            APP_URL: "http://localhost",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  };
});
