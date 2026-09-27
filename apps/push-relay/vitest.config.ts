import { defineConfig } from "vitest/config";

// Plain Node: the relay only needs fetch and WebCrypto, both built in.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
