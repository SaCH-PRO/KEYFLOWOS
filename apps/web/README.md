This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Troubleshooting

### Turbopack HMR error: `react/jsx-dev-runtime` "module factory is not available"

**Symptom.** During development, the browser console shows an error like:

> Module `next/.../react/jsx-dev-runtime.js [app-client]` was instantiated because it was required from module `<some "use client" file>`, but the module factory is not available. It might have been deleted in an HMR update.

The reported "from" file moves around — `theme-provider.tsx`, `error.tsx`, `providers.tsx`, etc. Editing one file makes it disappear; the next edit usually surfaces it on a different file. Tasks #216 and #225 both attempted per-file mitigations and only delayed the recurrence.

**Root cause (confirmed in Task #226).** The web app previously combined two settings in `apps/web/next.config.ts` that conflict with each other:

```ts
// BAD — do not reintroduce
transpilePackages: ["@keyflow/ui"],
turbopack: {
  root: repoRoot,
  resolveAlias: {
    "@keyflow/ui": "../../packages/ui/src/index.ts", // relative path!
  },
},
```

Turbopack resolves a *relative* `resolveAlias` value per-importer, not relative to `turbopack.root`. The repo has 40+ files that import from `@keyflow/ui` at many directory depths (`apps/web/src/app/book/page.tsx`, `apps/web/src/app/app/connect/forms/[formId]/page.tsx`, etc.), so the same alias produced many different absolute target paths. Turbopack treated each resolution as a distinct module, instantiating duplicate copies of `@keyflow/ui` and — transitively — duplicate factories for `react/jsx-dev-runtime` imported from inside those copies. On the next HMR cycle Turbopack tore one copy down while other duplicate graphs were still pointed at it, producing the "module factory is not available" error. Whichever client module happened to be rebuilt first appeared as the "from" file, which is why per-file fixes never held.

**Mitigation applied (Task #226).** The `turbopack.resolveAlias` block was removed. `transpilePackages: ["@keyflow/ui"]` is sufficient on its own because:

- `apps/web/node_modules/@keyflow/ui` is a pnpm workspace symlink to `packages/ui`.
- `packages/ui/package.json` already exposes its TypeScript source via `"main"`, `"module"`, `"types"`, and `"exports"` (all pointing at `./src/index.ts`).
- `transpilePackages` then tells Next to compile that source through its own pipeline, with **one** canonical resolution per import specifier — no duplicate module graphs.

After the change, the full edit script from the task (touching `theme-provider.tsx`, `error.tsx`, `providers.tsx`, `register-sw.tsx`, `pwa-install-prompt.tsx`, `theme-context.tsx`, `global-error.tsx`, plus several `@keyflow/ui` consumer pages in succession) no longer reproduces the error and HMR continues to apply changes in place.

**Contributor rules to keep this from coming back.**

1. **Do not add entries to `turbopack.resolveAlias` that point at TypeScript source files inside a workspace package.** If a workspace package needs to be consumed as source, expose it through that package's own `package.json` `exports` field and list it in `transpilePackages` — not through a per-app alias.
2. **Never use a relative path as a `resolveAlias` value.** Turbopack resolves them per-importer, which silently duplicates the module graph in any non-trivial codebase. If an absolute path is genuinely needed, use `path.resolve(...)` so there is exactly one target string.
3. **Keep all root-layout client providers inside the single `Providers` wrapper** at `apps/web/src/components/providers.tsx`. Mounting multiple sibling `"use client"` modules directly under the server-rendered `app/layout.tsx` is not the root cause documented above, but it does enlarge the surface where HMR factory bugs become visible. Route-level `error.tsx` / `global-error.tsx` files are required Next.js conventions and are exempt — they are mounted by the framework's error slot, not by the layout.

If the error ever resurfaces despite the rules above:

1. Stop the dev server, remove the Turbopack cache, and restart:
   ```bash
   rm -rf apps/web/.next apps/web/node_modules/.cache
   pnpm --filter web dev
   ```
2. Confirm `next-themes` (and any provider library used at the root) declares the React major in use under `peerDependencies`. With React 19 + Next 16 (Turbopack), `next-themes` must be `^0.4.x` or newer — older 0.3.x releases declare React 16-18 only and trigger spurious HMR failures.
3. Re-check `apps/web/next.config.ts` for any newly added `turbopack.resolveAlias` entries pointing at workspace TypeScript sources, and remove them.
4. **Root error boundaries are special — handle them as follows.** They are loaded on-demand (only when an error actually occurs), so by the time they instantiate, many HMR cycles have already happened and the `jsx-dev-runtime` factory bound to a `.tsx` file is the most likely casualty. Even using `React.createElement` in the body is **not enough** — SWC auto-injects `import "react/jsx-dev-runtime"` into every `.tsx` file regardless of whether JSX is used. The only definitive fixes are:
   - **Delete `apps/web/src/app/error.tsx` (root level).** It is optional in Next.js. `apps/web/src/app/global-error.ts` covers every error case it would have caught.
   - **Keep `apps/web/src/app/global-error.ts` as `.ts` (NOT `.tsx`).** Use `React.createElement` in the body. The `.ts` extension blocks SWC's automatic JSX runtime import.
   - Do NOT apply this to ordinary route files or to nested-segment `error.tsx` files (e.g. `app/app/error.tsx`) — those re-render on navigation, so their factories stay warm.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
