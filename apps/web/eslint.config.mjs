import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import unusedImports from "eslint-plugin-unused-imports";

// React 19's new compiler-aware hook rules were introduced by the React 19 /
// Next 16 upgrade. The codebase has been refactored to fully comply with
// `react-hooks/purity`, `react-hooks/preserve-manual-memoization`,
// `react-hooks/refs`, `react-hooks/static-components`, and
// `react-hooks/immutability` — those rules now run at their default severity.
//
// `react-hooks/set-state-in-effect` remains demoted to "warn": the codebase
// has ~140 surfaced occurrences (sync-prop-to-state mirrors, hydration of
// async data into local form state, derived list/pagination state in CRM,
// commerce, marketing, and inbox surfaces). Each requires a per-component
// refactor to either lift state up, derive during render, or use the new
// `useEffectEvent` pattern, which is being tracked as separate follow-up
// work. Demoted to "warn" so new offenders still surface in PR review while
// allowing the build to pass.
const reactCompilerStrictRules = {
  "react-hooks/set-state-in-effect": "warn",
};

// `@typescript-eslint/no-explicit-any` is enforced as an error so that any
// new `any` introduced after this point trips the build. The bulk of the
// pre-existing offenders (≈760, concentrated in untyped LLM tool result
// renderers, the legacy generic API client wrapper, and marketplace/commerce
// domain DTO consumers) are individually suppressed at their site with a
// `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <reason>`
// comment that documents the underlying tech-debt category. Suppressions
// should only be added with a similar specific justification.
const inheritedTechDebtRules = {
  "@typescript-eslint/no-explicit-any": "error",
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
      // Honor the leading-underscore convention for intentionally unused
      // identifiers (params, destructured siblings, caught errors). This
      // matches the cleanup convention used across the codebase after the
      // React 19 / Next 16 upgrade dead-code sweep.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
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
