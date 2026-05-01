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

If the dev console shows an error like:

> Module `react/jsx-dev-runtime` was instantiated because it was required from module `theme-provider.tsx`, but the module factory is not available. It might have been deleted in an HMR update.

Try the following, in order:

1. Stop the dev server, remove the Turbopack cache, and restart:
   ```bash
   rm -rf apps/web/.next apps/web/node_modules/.cache
   pnpm --filter web dev
   ```
2. If the error returns, confirm `next-themes` (and any provider library used in the root layout) is on a version whose `peerDependencies` include the React major you're running. With React 19 + Next 16 (Turbopack), `next-themes` must be `^0.4.x` or newer — older 0.3.x releases declare React 16-18 only and trigger this HMR failure.
3. Make sure every client provider used at the root layout boundary lives inside the single `Providers` wrapper at `apps/web/src/components/providers.tsx` — do not render `ThemeProvider`, `ThemeColorsProvider`, `RegisterSW`, `PWAInstallPrompt`, `Toaster`, or any other `"use client"` module as a direct child of the server-rendered `app/layout.tsx`. Mounting multiple sibling client modules at the root is a recurring trigger for the "module factory is not available" HMR error on Next 16 + Turbopack + React 19; collapsing them into one client boundary prevents Turbopack from dropping individual factories during HMR.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
