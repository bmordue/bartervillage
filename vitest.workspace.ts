import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
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
