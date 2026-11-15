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
  },
});
