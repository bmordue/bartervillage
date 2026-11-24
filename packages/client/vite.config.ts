import { defineConfig } from "vite";

/**
 * Vite config for the browser bundle (M5.A01).
 *
 * Preact's automatic JSX runtime is selected through esbuild so no framework
 * preset is required. Type checking stays with `tsc` (`npm run typecheck`).
 */
export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  server: {
    port: 5173,
    proxy: {
      "/world": "http://127.0.0.1:3000",
      "/plot": "http://127.0.0.1:3000",
      "/player": "http://127.0.0.1:3000",
      "/players": "http://127.0.0.1:3000",
      "/barter": "http://127.0.0.1:3000",
      "/replay": "http://127.0.0.1:3000",
      "/site": "http://127.0.0.1:3000",
      "/ready": "http://127.0.0.1:3000",
      "/push": "http://127.0.0.1:3000",
      "/vapid-key": "http://127.0.0.1:3000",
      "/auth": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
});
