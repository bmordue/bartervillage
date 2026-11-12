import tseslint from "typescript-eslint";

const forbiddenRuleImports = [
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "http",
  "node:http",
  "https",
  "node:https",
  "net",
  "node:net",
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads",
  "crypto",
  "node:crypto",
  "better-sqlite3",
];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "**/*.db"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": "off",
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["packages/rules/src/**/*.ts"],
    ignores: ["packages/rules/src/clock.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: forbiddenRuleImports.map((name) => ({
            name,
            message: "The rules package must stay pure: no I/O, database or network.",
          })),
          patterns: [
            {
              group: [
                "@bartervillage/server",
                "@bartervillage/worker",
                "@bartervillage/client",
                "@bartervillage/content",
              ],
              message: "The rules package must not depend on runtime packages.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "The rules package must not use the network." },
        { name: "process", message: "The rules package must not use the process object." },
        { name: "require", message: "The rules package must use ESM imports." },
        { name: "XMLHttpRequest", message: "The rules package must not use the network." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use the injected seeded Rng instead of Math.random.",
        },
        {
          object: "Date",
          property: "now",
          message: "Use the injected Clock for scheduling instead of Date.now.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date']",
          message: "Use the injected Clock for scheduling instead of constructing Date.",
        },
      ],
    },
  },
  {
    // These modules only convert the injected instant; neither reads ambient time.
    files: ["packages/rules/src/clock.ts", "packages/rules/src/deadline.ts"],
    rules: {
      "no-restricted-properties": "off",
      "no-restricted-syntax": "off",
    },
  },
);
