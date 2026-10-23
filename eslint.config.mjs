import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: { next: { rootDir: "apps/web/" } },
  },
  {
    // packages/core runs anywhere (Node, the browser, edge runtimes); only its tests may use Node.
    files: ["packages/core/src/**/*.ts"],
    ignores: ["**/*.test.ts", "packages/core/src/sources/fake-http.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["node:*"], message: "packages/core must stay runtime-agnostic." }] },
      ],
    },
  },
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/out/**",
    "**/coverage/**",
    "**/next-env.d.ts",
  ]),
]);
