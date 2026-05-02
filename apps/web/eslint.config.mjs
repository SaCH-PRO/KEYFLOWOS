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
// `react-hooks/set-state-in-effect` also runs at its default severity. The
// previously surfaced ~141 occurrences (sync-prop-to-state mirrors, hydration
// of async/server data into local form state, derived list/pagination state
// in CRM, commerce, marketing, inbox, and community surfaces) have each been
// audited and either refactored or covered by a per-line
// `// eslint-disable-next-line react-hooks/set-state-in-effect -- <reason>`
// comment that documents the underlying pattern category (async hydration,
// loading flag lifecycle, prop/modal mirror reset, external subscription,
// client-only storage hydration, or transient toast feedback).
//
// `@typescript-eslint/no-explicit-any` is enforced as an error. The codebase
// is fully `any`-free; new `any` introductions trip the build. Prefer
// narrowing with proper backend/Prisma-derived types (or `unknown` + a runtime
// guard) over adding suppression comments.
const inheritedTechDebtRules = {
  "@typescript-eslint/no-explicit-any": "error",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: { "unused-imports": unusedImports },
    rules: {
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
