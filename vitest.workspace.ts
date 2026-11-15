import { defineWorkspace } from "vitest/config";

// Preact's automatic JSX runtime for component tests (M5.A01).
const preact = {
  esbuild: { jsx: "automatic" as const, jsxImportSource: "preact" },
};

export default defineWorkspace([
  {
    ...preact,
    test: {
      name: "unit",
      include: ["packages/**/test/**/*.unit.test.ts", "packages/**/src/**/*.unit.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "property",
      include: ["packages/**/test/**/*.property.test.ts", "packages/**/src/**/*.property.test.ts"],
      environment: "node",
    },
  },
  {
    test: {
      name: "golden",
      include: ["packages/**/test/golden/**/*.golden.test.ts"],
      environment: "node",
    },
  },
]);
