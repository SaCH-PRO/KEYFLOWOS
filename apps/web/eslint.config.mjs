import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";

// React 19's new compiler-aware hook rules (set-state-in-effect, purity,
// preserve-manual-memoization, refs, static-components, immutability) were
// introduced by the React 19 / Next 16 upgrade. They flag patterns that
// pre-date the stricter defaults and each violation needs a per-component
// refactor to fix correctly. Surfaced as warnings while that work is
// scheduled (tracked separately). All other React 19 hook rules
// (rules-of-hooks, exhaustive-deps) keep their default severity.
const reactCompilerStrictRules = {
  "react-hooks/set-state-in-effect": "warn",
  "react-hooks/purity": "warn",
  "react-hooks/preserve-manual-memoization": "warn",
  "react-hooks/refs": "warn",
  "react-hooks/static-components": "warn",
  "react-hooks/immutability": "warn",
};

// `@typescript-eslint/no-explicit-any` was promoted to "error" by the upgrade
// (it ships as error in @typescript-eslint/recommended, which the new
// eslint-config-next/typescript pulls in). The codebase pre-dates this and
// has ~536 occurrences concentrated in domain-handler code that integrates
// with untyped API responses (inventory dashboard, CRM/commerce tool result
// renderers, marketplace, the API client wrapper). Cleaning these up
// correctly requires authoring shared schema types alongside the backend
// contract, which is being tracked as separate follow-up work. Demoted to
// "warn" so the rule continues to surface new offenders in PR review while
// allowing the build to pass.
const inheritedTechDebtRules = {
  "@typescript-eslint/no-explicit-any": "warn",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { "unused-imports": unusedImports },
    rules: {
      ...reactCompilerStrictRules,
      ...inheritedTechDebtRules,
      // Auto-fixable removal of unused imports. Unused locals are still
      // flagged by @typescript-eslint/no-unused-vars (warning).
      "unused-imports/no-unused-imports": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright e2e tests are linted/typechecked separately by Playwright
    "e2e/**",
    "playwright.config.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
