/**
 * MARKETING-REDIRECT-GATE (v1 step 3, ruling D-152 `hide`): the /app/marketing
 * redirect no longer walks round the dormant-feature gate.
 *
 * The marketing screen lives at app/app/marketing/page.tsx, under
 * app/app/marketing/layout.tsx, which wraps it in
 * <DormantFeatureGate flag="contentScheduler" label="Content">. In production
 * every dormant flag defaults to OFF (lib/feature-flags.ts), so the gate shows
 * "Content is coming soon" instead of mounting the module.
 *
 * But next.config.ts sends /app/marketing to /app/communicate/campaigns with a
 * permanent 308, and app/app/communicate/campaigns/page.tsx was a bare
 * `export { default } from "@/app/app/marketing/page"`. That route has no
 * marketing layout above it, so the same screen rendered there ungated: a
 * module v1 hides was one click from the Commerce hub ("Mass Comms") and one
 * old bookmark away, in production.
 *
 * The redirect stays as it is (an existing 308 is never reversed: browsers
 * cache it). The campaigns route wears the marketing tree's gate instead.
 *
 * What this file proves:
 *   - the redirect is unchanged (next.config.ts, read as text the way
 *     redirect-shadowing.spec.ts and tool-route-audit.ts read it);
 *   - under production flags (NODE_ENV=production, no NEXT_PUBLIC_FF_*
 *     override) /app/communicate/campaigns renders the dormant state, never
 *     mounts the marketing screen, and shows exactly what the gated marketing
 *     tree shows;
 *   - the gate is the content-scheduler flag and nothing stronger: switched on
 *     (NEXT_PUBLIC_FF_CONTENT_SCHEDULER=true, or development defaults) the
 *     campaigns route renders the marketing screen again;
 *   - the class, statically: every next.config redirect out of a gated tree
 *     lands on a route gated by the same flag, and every page outside a gated
 *     tree that renders a gated tree's page wears that tree's gate.
 *
 * The marketing screen itself is replaced by a marker that counts its renders:
 * this file is about the door, not the 1,100-line screen behind it, and a
 * marker that never renders proves the module was not mounted (so none of its
 * on-mount fetching ran).
 */
import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentType, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const marketingScreen = vi.hoisted(() => ({ renders: 0 }));

vi.mock("@/app/app/marketing/page", async () => {
  const React = await import("react");
  return {
    default: function MarketingScreenMarker() {
      marketingScreen.renders += 1;
      return React.createElement("div", { "data-testid": "marketing-screen" }, "Marketing campaigns screen");
    },
  };
});

const WEB = path.resolve(__dirname, "../..");
const SRC = path.join(WEB, "src");
const APP = path.join(SRC, "app");
const CONFIG = path.join(WEB, "next.config.ts");

const CAMPAIGNS_PAGE = path.join(APP, "app/communicate/campaigns/page.tsx");
const MARKETING_LAYOUT = path.join(APP, "app/marketing/layout.tsx");

type FlagEnv = { NODE_ENV: string; NEXT_PUBLIC_FF_CONTENT_SCHEDULER?: string };

/**
 * Load the route modules fresh under the given flag environment.
 *
 * lib/feature-flags computes its map once, at module load, from NODE_ENV and
 * the NEXT_PUBLIC_FF_* overrides (Next inlines both at build time). So the
 * module registry is reset, the flag module alone is evaluated under the
 * stubbed environment, and the environment is restored before the routes are
 * imported: they bind to that flag map, while React and the rest of
 * node_modules keep the test build (a production NODE_ENV while
 * react/jsx-dev-runtime loads leaves jsxDEV undefined).
 */
async function loadRoutes(env: FlagEnv) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", env.NODE_ENV);
  vi.stubEnv("NEXT_PUBLIC_FF_CONTENT_SCHEDULER", env.NEXT_PUBLIC_FF_CONTENT_SCHEDULER);
  const flags = await import("@/lib/feature-flags");
  vi.unstubAllEnvs();
  const CampaignsPage = (await import("@/app/app/communicate/campaigns/page")).default as ComponentType;
  const MarketingLayout = (await import("@/app/app/marketing/layout")).default as ComponentType<{ children: ReactNode }>;
  const MarketingPage = (await import("@/app/app/marketing/page")).default as ComponentType;
  return {
    flags,
    renderCampaigns: () => render(createElement(CampaignsPage)),
    renderMarketingTree: () => render(createElement(MarketingLayout, null, createElement(MarketingPage))),
  };
}

const PRODUCTION: FlagEnv = { NODE_ENV: "production", NEXT_PUBLIC_FF_CONTENT_SCHEDULER: undefined };

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  marketingScreen.renders = 0;
});

// ---------------------------------------------------------------------------
// next.config.ts, read as text
// ---------------------------------------------------------------------------

type Rule = { source: string; destination: string; permanent: boolean | null };

/** The redirect table as written in next.config.ts. */
function redirectRules(): Rule[] {
  const cfg = fs.readFileSync(CONFIG, "utf8");
  const re = /\{\s*source:\s*["'`]([^"'`]+)["'`],\s*destination:\s*["'`]([^"'`]+)["'`],(?:\s*permanent:\s*(true|false),)?/g;
  const out: Rule[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cfg))) out.push({ source: m[1], destination: m[2], permanent: m[3] == null ? null : m[3] === "true" });
  return out;
}

const baseOf = (source: string) => source.replace(/\/:path\*?$/, "");

// ---------------------------------------------------------------------------
// Gated trees and the pages that render them, read as text
// ---------------------------------------------------------------------------

const GATE = /<DormantFeatureGate\s[^>]*?flag=["'](\w+)["']/;

/** Every file under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const relApp = (file: string) => path.relative(APP, file).split(path.sep).join("/");

/** A route directory's URL path: route groups `(x)` are not in the URL. */
function routeOf(dir: string): string {
  const segs = path.relative(APP, dir).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

/** Directories whose layout wraps every page beneath them in a DormantFeatureGate, with its flag. */
function gatedTrees(): { dir: string; route: string; flag: string }[] {
  return walk(APP)
    .filter((f) => /[\\/]layout\.(tsx|ts|jsx|js)$/.test(f))
    .map((f) => ({ f, m: GATE.exec(fs.readFileSync(f, "utf8")) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
    .map(({ f, m }) => ({ dir: path.dirname(f), route: routeOf(path.dirname(f)), flag: m[1] }));
}

const inside = (file: string, dir: string) => file === dir || file.startsWith(dir + path.sep);

/** The gate flags that wrap a route file: its own gate, then every ancestor layout's. */
function gateFlagsOver(pageFile: string): string[] {
  const flags: string[] = [];
  const own = GATE.exec(fs.readFileSync(pageFile, "utf8"));
  if (own) flags.push(own[1]);
  let dir = path.dirname(pageFile);
  while (inside(dir, APP)) {
    for (const ext of ["tsx", "ts", "jsx", "js"]) {
      const layout = path.join(dir, `layout.${ext}`);
      if (fs.existsSync(layout)) {
        const m = GATE.exec(fs.readFileSync(layout, "utf8"));
        if (m) flags.push(m[1]);
      }
    }
    if (dir === APP) break;
    dir = path.dirname(dir);
  }
  return flags;
}

/** The page file a URL path renders (no dynamic segments needed here). */
function pageFileFor(route: string): string | null {
  for (const ext of ["tsx", "ts", "jsx", "js"]) {
    const f = path.join(APP, ...route.split("/").filter(Boolean), `page.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * Module specifiers a file imports or re-exports from (`import x from`,
 * `export { default } from`, a side-effect `import "x"`, a lazy `import("x")`),
 * resolved to files under src.
 */
function importedFiles(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const re = /\b(?:from|import)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const spec = m[1];
    let base: string | null = null;
    if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(file), spec);
    if (!base) continue;
    for (const candidate of [base, ...["tsx", "ts", "jsx", "js"].map((e) => `${base}.${e}`), ...["tsx", "ts"].map((e) => path.join(base!, `index.${e}`))]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

const isPageModule = (f: string) => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f);

// ---------------------------------------------------------------------------

describe("MARKETING-REDIRECT-GATE: the /app/marketing redirect keeps the dormant gate", () => {
  describe("next.config.ts: the redirect stays as it is", () => {
    it("parses the redirect table (sanity: the assertions below are not vacuous)", () => {
      expect(redirectRules().length).toBeGreaterThan(15);
    });

    it("/app/marketing is still a permanent redirect to /app/communicate/campaigns", () => {
      const rules = redirectRules().filter((r) => r.source === "/app/marketing");
      expect(rules).toEqual([{ source: "/app/marketing", destination: "/app/communicate/campaigns", permanent: true }]);
    });

    it("nothing redirects /app/communicate/campaigns elsewhere: it is the route that renders", () => {
      expect(redirectRules().filter((r) => baseOf(r.source) === "/app/communicate/campaigns")).toEqual([]);
      expect(pageFileFor("/app/communicate/campaigns")).toBe(CAMPAIGNS_PAGE);
    });
  });

  describe("under production flags", () => {
    it("the flag map is the production one (sanity: contentScheduler is off)", async () => {
      const { flags } = await loadRoutes(PRODUCTION);
      expect(flags.isFeatureEnabled("contentScheduler")).toBe(false);
    });

    it("/app/communicate/campaigns shows the dormant state, not the marketing screen", async () => {
      const { renderCampaigns } = await loadRoutes(PRODUCTION);
      renderCampaigns();

      expect(screen.queryByTestId("marketing-screen"), "the marketing screen rendered behind the redirect").not.toBeInTheDocument();
      expect(marketingScreen.renders, "the marketing screen mounted behind the redirect").toBe(0);
      expect(screen.getByRole("heading", { name: "Content is coming soon" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Back to KEYFLOW/ })).toHaveAttribute("href", "/app/keyflow-command");
    });

    it("it shows exactly what the gated marketing tree shows (same flag, same label)", async () => {
      const routes = await loadRoutes(PRODUCTION);
      const campaigns = routes.renderCampaigns().container.innerHTML;
      cleanup();
      const tree = routes.renderMarketingTree().container.innerHTML;

      expect(tree).toContain("Content is coming soon");
      expect(campaigns).toBe(tree);
      expect(marketingScreen.renders).toBe(0);
    });
  });

  describe("the gate is the content-scheduler flag, nothing stronger", () => {
    it("NEXT_PUBLIC_FF_CONTENT_SCHEDULER=true in production renders the marketing screen on the campaigns route", async () => {
      const { flags, renderCampaigns } = await loadRoutes({ NODE_ENV: "production", NEXT_PUBLIC_FF_CONTENT_SCHEDULER: "true" });
      expect(flags.isFeatureEnabled("contentScheduler")).toBe(true);
      renderCampaigns();

      expect(screen.getByTestId("marketing-screen")).toBeInTheDocument();
      expect(screen.queryByText(/is coming soon/)).not.toBeInTheDocument();
    });

    it("development defaults (every dormant flag on) render the marketing screen on the campaigns route", async () => {
      const { flags, renderCampaigns } = await loadRoutes({ NODE_ENV: "development", NEXT_PUBLIC_FF_CONTENT_SCHEDULER: undefined });
      expect(flags.isFeatureEnabled("contentScheduler")).toBe(true);
      renderCampaigns();

      expect(screen.getByTestId("marketing-screen")).toBeInTheDocument();
    });
  });

  describe("the class: no door out of a gated tree skips its gate", () => {
    it("finds the gated trees (sanity), the marketing tree among them", () => {
      const trees = gatedTrees();
      expect(trees.length).toBeGreaterThanOrEqual(5);
      expect(trees).toContainEqual({ dir: path.dirname(MARKETING_LAYOUT), route: "/app/marketing", flag: "contentScheduler" });
    });

    it("every next.config redirect out of a gated tree lands on a route gated by the same flag", () => {
      const trees = gatedTrees();
      const checked: string[] = [];
      const ungated: string[] = [];
      for (const rule of redirectRules()) {
        const source = baseOf(rule.source);
        const tree = trees.find((t) => source === t.route || source.startsWith(t.route + "/"));
        if (!tree) continue;
        if (rule.destination === tree.route || rule.destination.startsWith(tree.route + "/")) continue;
        checked.push(`${rule.source} -> ${rule.destination}`);
        const page = pageFileFor(rule.destination);
        if (!page || !gateFlagsOver(page).includes(tree.flag)) {
          ungated.push(
            `${rule.source} -> ${rule.destination}: ${page ? relApp(page) : "(no page)"} is not behind ` +
              `<DormantFeatureGate flag="${tree.flag}">, so the gated screen renders there in production`,
          );
        }
      }
      expect(checked, "the census saw no redirect out of a gated tree").toContain("/app/marketing -> /app/communicate/campaigns");
      expect(ungated).toEqual([]);
    });

    it("every page outside a gated tree that renders a gated tree's page wears that tree's gate", () => {
      const trees = gatedTrees();
      const pages = walk(APP).filter(isPageModule);
      const borrowers: string[] = [];
      const ungated: string[] = [];
      for (const page of pages) {
        if (trees.some((t) => inside(page, t.dir))) continue;
        for (const imported of importedFiles(page).filter(isPageModule)) {
          const tree = trees.find((t) => inside(imported, t.dir));
          if (!tree) continue;
          borrowers.push(relApp(page));
          if (!gateFlagsOver(page).includes(tree.flag)) {
            ungated.push(
              `${relApp(page)} renders ${relApp(imported)} without <DormantFeatureGate flag="${tree.flag}">`,
            );
          }
        }
      }
      expect(borrowers, "the census saw no page borrowing a gated page").toContain("app/communicate/campaigns/page.tsx");
      expect(ungated).toEqual([]);
    });
  });
});
