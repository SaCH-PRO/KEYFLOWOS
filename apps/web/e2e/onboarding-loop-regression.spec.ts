import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

/**
 * Regression guard for the post-Task-#293 onboarding redirect loop.
 *
 * BUG (sachdookie@gmail.com, May 2026): after a successful Google sign-in,
 * brand-new users landed on a blank "Opening Get Started…" screen and could
 * never reach the app shell. Root cause was an effect in `app/app/layout.tsx`
 * that called `router.push("/app/onboarding")` whenever the bootstrap business
 * row had `onboardingComplete=false` (the default for a brand-new business).
 * Task #293 had already deleted the multi-step onboarding wizard, so
 * `/app/onboarding` immediately did `router.replace("/app")`, which re-fired
 * the layout effect — infinite ping-pong.
 *
 * The fix (commit 163e316c) removes that redirect block entirely; the new
 * "Get Started" affordance lives in the Notes drawer.
 *
 * This guard fails the build if anyone re-introduces the redirect, even via
 * a different code path. We assert against the actual file contents because
 * a full browser e2e on Next 16 dev is too slow + flaky to run in CI for a
 * one-line regression like this.
 */
test.describe("Onboarding redirect loop is dead", () => {
  const layoutPath = resolve(__dirname, "../src/app/app/layout.tsx");
  const layoutSource = readFileSync(layoutPath, "utf8");

  test("app layout never pushes/replaces to /app/onboarding", () => {
    // Strip comments so we don't trip on the explanatory note left behind
    // by the fix itself.
    const stripped = layoutSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    // Any router navigation to /app/onboarding is the regression.
    expect(stripped, "router.push to /app/onboarding has come back").not.toMatch(
      /router\s*\.\s*push\(\s*["'`]\/app\/onboarding/,
    );
    expect(stripped, "router.replace to /app/onboarding has come back").not.toMatch(
      /router\s*\.\s*replace\(\s*["'`]\/app\/onboarding/,
    );
    // Defensive: also catch raw window.location assignments.
    expect(stripped, "window.location to /app/onboarding has come back").not.toMatch(
      /location\s*\.\s*(?:href|assign|replace)\s*[=(]\s*["'`]\/app\/onboarding/,
    );
  });

  test("explanatory note about the loop fix is still present", () => {
    // If someone removes the comment, they probably also removed the
    // context for *why* the redirect was deleted — fail loudly so they
    // re-read this file.
    expect(
      layoutSource,
      "the comment that documents the onboarding-loop fix has been removed; before re-adding any onboarding redirect, read this regression spec",
    ).toMatch(/onboarding/i);
    expect(layoutSource).toMatch(/Notes drawer|notes drawer|Get Started/);
  });

  test("/app/onboarding page still soft-redirects back to /app (no loop bait)", () => {
    const onboardingPath = resolve(__dirname, "../src/app/app/onboarding/page.tsx");
    const src = readFileSync(onboardingPath, "utf8");
    // The /app/onboarding route must redirect *to* /app, otherwise a stray
    // bookmark resurrects a dead-end screen.
    expect(src).toMatch(/router\s*\.\s*replace\(\s*["'`]\/app["'`]/);
  });

  test("no file under apps/web/src navigates to /app/onboarding", () => {
    // Scope check beyond just layout.tsx: any new component, hook, or
    // effect that pushes/replaces/redirects to /app/onboarding will
    // resurrect the loop, since /app/onboarding bounces straight back to
    // /app. Walk the whole src tree and flag offenders.
    const srcRoot = resolve(__dirname, "../src");
    const onboardingPageFile = resolve(srcRoot, "app/app/onboarding/page.tsx");

    const offenders: string[] = [];
    const exts = new Set([".ts", ".tsx", ".js", ".jsx"]);

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = resolve(dir, entry);
        const s = statSync(full);
        if (s.isDirectory()) {
          if (entry === "node_modules" || entry === ".next") continue;
          walk(full);
          continue;
        }
        const dot = entry.lastIndexOf(".");
        if (dot < 0 || !exts.has(entry.slice(dot))) continue;
        // The onboarding page itself legitimately mentions its own path.
        if (full === onboardingPageFile) continue;
        const raw = readFileSync(full, "utf8");
        const stripped = raw
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, "");
        const navPattern =
          /(?:router\s*\.\s*(?:push|replace)|redirect|location\s*\.\s*(?:href|assign|replace)\s*[=(])\s*\(?\s*["'`]\/app\/onboarding/;
        if (navPattern.test(stripped)) {
          offenders.push(relative(srcRoot, full));
        }
      }
    };
    walk(srcRoot);

    expect(
      offenders,
      `the following files navigate to /app/onboarding and will recreate the redirect loop:\n  - ${offenders.join("\n  - ")}\n\nIf you genuinely need an onboarding screen, build a new route — do NOT route back to /app/onboarding, which only soft-redirects to /app.`,
    ).toEqual([]);
  });
});
