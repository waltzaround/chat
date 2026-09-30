// A separate local database keeps recordings away from your development data.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";
export default defineConfig({
  cacheDir: "node_modules/.vite-demo",
  plugins: [react(), tailwindcss(), cloudflare({ persistState: { path: ".wrangler/demo-state" } })],
  resolve: { alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    "@db": fileURLToPath(new URL("./db", import.meta.url)),
  } },
});
