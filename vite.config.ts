import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
      "@db": path.resolve(__dirname, "./db"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the media SDK in its own chunk so text-only sessions never download it eagerly.
        advancedChunks: {
          groups: [{ name: "realtimekit", test: /node_modules[\\/]@cloudflare[\\/]realtimekit/ }],
        },
      },
    },
  },
});
