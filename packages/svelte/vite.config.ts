import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: "../../web-dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
    },
  },
});
