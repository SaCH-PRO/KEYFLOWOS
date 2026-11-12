import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

/**
 * Regression guard for the onboarding redirect: who sends an owner to
 * /app/onboarding, on what condition, and how the owner gets out again.
 *
 * Rewritten by R0-25-PLAYWRIGHT-R0. The previous version asserted facts that
 * stopped being true: it read only app/app/layout.tsx, which has never held the
 * redirect (the layout mounts `useGenomeGate`, and the redirect lives in
 * hooks/use-genome-gate.ts), so its first case passed without looking at the
 * code it guarded; and it asserted that /app/onboarding is a Server Component
 * redirecting to the Business Genome tab, when /app/onboarding is the
 * onboarding page itself, with the manual path (R0-06, owner ruling D-03).
 *
 * What holds now, and what this file pins:
 *   - layout.tsx mounts the gate and never navigates to /app/onboarding itself;
 *   - the gate (use-genome-gate.ts) is the redirect. It sends an owner to
 *     /app/onboarding only from a path that is not allowed during onboarding,
 *     and /app/onboarding is one of the allowed paths, so it cannot loop. It
 *     gates on ONBOARDING completion alone (not the three-pillar genome
 *     score), and an unreadable onboarding state fails open (D-03);
 *   - /app/onboarding renders the manual path, which saves the minimal profile
 *     and completes onboarding through the server with no AI call, then leaves
 *     for the workspace; a completed owner who lands on /app/onboarding is sent
 *     to the workspace too;
 *   - nothing else in apps/web/src navigates to /app/onboarding, except the
 *     sign-in callback for a brand-new business (once, after sign-in).
 *
 * The browser half (GET /app redirects a new owner to /app/onboarding, and the
 * manual path completes) is driven live by release0-live.spec.ts.
 */

const SRC = resolve(__dirname, "../src");
const read = (path: string) => readFileSync(resolve(SRC, path), "utf8");
/** Comments removed, so a commented-out call neither passes nor fails a case. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const LAYOUT = "app/app/layout.tsx";
const GATE = "hooks/use-genome-gate.ts";
const ONBOARDING_PAGE = "app/app/onboarding/page.tsx";
const ONBOARDING_HOOK = "app/app/onboarding/hooks/use-onboarding.ts";
const MANUAL_STEP = "app/app/onboarding/components/manual-setup-step.tsx";
const AUTH_CALLBACK = "app/auth/callback/page.tsx";

/** Every navigation call (router.push/replace, redirect, location.*) with its argument text. */
function navigations(src: string): Array<{ call: string; args: string }> {
  const found: Array<{ call: string; args: string }> = [];
  const pattern = /(router\s*\.\s*(?:push|replace)|\bredirect|location\s*\.\s*(?:assign|replace))\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)|location\s*\.\s*href\s*=\s*([^;\n]+)/g;
  for (const m of src.matchAll(pattern)) {
    found.push({ call: (m[1] ?? "location.href").replace(/\s+/g, ""), args: (m[2] ?? m[3] ?? "").trim() });
  }
  return found;
}

const toOnboarding = (args: string) => /["'`]\/app\/onboarding(?:["'`?/]|\$\{)/.test(args);

test.describe("Onboarding redirect: the gate, the manual path, no loop", () => {
  test("app/app/layout.tsx mounts the genome gate and never navigates to /app/onboarding itself", () => {
    const layout = code(LAYOUT);
    expect(layout).toMatch(/import\s*\{\s*useGenomeGate\s*\}\s*from\s*["']@\/hooks\/use-genome-gate["']/);
    expect(layout).toMatch(/const\s+genomeGate\s*=\s*useGenomeGate\(\s*\)/);
    // While the gate checks, the layout holds a spinner instead of the page.
    expect(layout).toMatch(/if\s*\(\s*genomeGate\.checking\s*\)/);
    expect(navigations(layout).filter((n) => toOnboarding(n.args)), "layout.tsx navigates to /app/onboarding").toEqual([]);
  });

  test("use-genome-gate.ts is the redirect: two guarded calls, /app/onboarding allowed, so no loop", () => {
    const gate = code(GATE);
    const calls = navigations(gate);
    // Exactly the two redirects: no business selected, and onboarding unfinished.
    expect(calls).toEqual([
      { call: "router.replace", args: '"/app/onboarding"' },
      { call: "router.replace", args: '"/app/onboarding"' },
    ]);
    // Each is guarded by the allowed-path check, so an allowed path is never redirected.
    expect(gate).toMatch(/if\s*\(\s*!isAllowedPath\(pathWithQuery\)\s*\)\s*\{\s*router\.replace\("\/app\/onboarding"\)/);
    expect(gate).toMatch(/if\s*\(\s*gateActive\s*&&\s*pathWithQuery\s*&&\s*!isAllowedPath\(pathWithQuery\)\s*\)\s*\{\s*router\.replace\("\/app\/onboarding"\)/);
    // /app/onboarding is itself allowed: the gate cannot send the onboarding page to itself.
    const allowed = gate.match(/const\s+ALLOWED_PATHS\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    expect(allowed).toMatch(/["']\/app\/onboarding["']/);
  });

  test("the gate closes on unfinished ONBOARDING only, not on the genome score, and fails open when the state cannot be read (D-03)", () => {
    const gate = code(GATE);
    expect(gate).toMatch(
      /const\s+onboardingFinished\s*=\s*data\.onboardingComplete\s*\|\|\s*data\.onboardingCompletedAt\s*!=\s*null\s*;/,
    );
    const gateActive = gate.match(/const\s+gateActive\s*=\s*([^;]+);/)?.[1]?.trim();
    expect(gateActive).toBe("!onboardingFinished");
    // A failed read (error, empty body, rejected promise) opens the gate and redirects nowhere.
    expect(gate).toMatch(/const\s+FAIL_OPEN_STATE\s*:\s*GenomeGateState\s*=\s*\{[^}]*gateActive:\s*false/);
    const failedRead = gate.match(/if\s*\(\s*error\s*\|\|\s*!data\s*\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
    expect(failedRead).toMatch(/setState\(FAIL_OPEN_STATE\)/);
    expect(failedRead).not.toMatch(/router\./);
    const rejected = gate.match(/\.catch\(\(err\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/)?.[1] ?? "";
    expect(rejected).toMatch(/setState\(FAIL_OPEN_STATE\)/);
    expect(rejected).not.toMatch(/router\./);
  });

  test("/app/onboarding is the onboarding page, not a redirect, and it offers the manual path (R0-06)", () => {
    const page = code(ONBOARDING_PAGE);
    expect(navigations(page)).toEqual([]);
    expect(page).toMatch(/import\s*\{\s*ManualSetupStep\s*,\s*useManualSetup\s*\}\s*from\s*["']\.\/components\/manual-setup-step["']/);
    expect(page).toMatch(/<ManualSetupStep\s+setup=\{manualSetup\}\s*\/>/);
  });

  test("the manual path saves the minimal profile, completes onboarding through the server with no AI call, and leaves for the workspace", () => {
    const manual = code(MANUAL_STEP);
    expect(manual).toMatch(/saveBusinessMinimalProfile\(/);
    expect(manual).toMatch(/markOnboardingComplete\(/);
    expect(manual).not.toMatch(/["'`]\/ai\//);
    expect(navigations(manual)).toEqual([{ call: "router.replace", args: '"/app/command-center"' }]);
  });

  test("a completed owner on /app/onboarding is sent to the workspace; the onboarding hook only moves between its own steps", () => {
    const hook = code(ONBOARDING_HOOK);
    expect(hook).toMatch(/if\s*\(\s*data\.onboardingComplete\s*\)\s*\{\s*router\.replace\("\/app\/command-center"\)/);
    const toOnboardingCalls = navigations(hook).filter((n) => toOnboarding(n.args));
    expect(toOnboardingCalls.length).toBeGreaterThan(0);
    for (const n of toOnboardingCalls) expect(n.args).toMatch(/^`\/app\/onboarding\?step=\$\{next\}`/);
  });

  test("the retired onboarding and blueprint routes redirect away from onboarding", () => {
    expect(navigations(code("app/app/onboarding/business-os/page.tsx"))).toEqual([{ call: "redirect", args: '"/app/genome"' }]);
    expect(statSync(resolve(SRC, "app/app/genome/page.tsx")).isFile()).toBe(true);
    expect(navigations(code("app/app/blueprint/page.tsx"))).toEqual([
      { call: "redirect", args: '"/app/profile?tab=business-genome&section=advanced-editor"' },
    ]);
  });

  test("nothing else under apps/web/src navigates to /app/onboarding", () => {
    const exts = new Set([".ts", ".tsx", ".js", ".jsx"]);
    const navigators: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === ".next" || entry === "__tests__") continue;
          walk(full);
          continue;
        }
        const dot = entry.lastIndexOf(".");
        if (dot < 0 || !exts.has(entry.slice(dot)) || /\.(test|spec)\.[jt]sx?$/.test(entry)) continue;
        const rel = relative(SRC, full);
        if (navigations(code(rel)).some((n) => toOnboarding(n.args))) navigators.push(rel);
      }
    };
    walk(SRC);

    expect(
      navigators.sort(),
      "a new navigation to /app/onboarding: make sure it cannot loop with the gate, then add it here",
    ).toEqual(
      [
        // The gate: guarded by isAllowedPath, see above.
        GATE,
        // Step changes inside the onboarding page (`/app/onboarding?step=...`).
        ONBOARDING_HOOK,
        // OAuth sign-in of a brand-new business: once, after sign-in, to the page the gate allows.
        AUTH_CALLBACK,
      ].sort(),
    );
    expect(navigations(code(AUTH_CALLBACK)).filter((n) => toOnboarding(n.args))).toEqual([
      { call: "router.push", args: 'bootstrap.data.isNewBusiness ? "/app/onboarding" : "/app"' },
    ]);
  });
});
