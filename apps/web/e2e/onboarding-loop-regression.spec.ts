import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

/**
 * Regression guard for the post-Task-#293 onboarding redirect loop, plus
 * Phase 6 route migrations:
 *   - /app/onboarding        → /app/profile?tab=business-genome&intro=1
 *   - /app/onboarding/business-os → /app/profile?tab=business-genome
 *   - /app/blueprint         → /app/profile?tab=business-genome&section=advanced-editor
 *
 * These routes are now thin Server Components that call `redirect(...)`,
 * so a stray bookmark can never re-enter the old Genesis wizard or legacy
 * Blueprint editor.
 */
test.describe("Business Genome route redirects are safe", () => {
  const layoutPath = resolve(__dirname, "../src/app/app/layout.tsx");
  const layoutSource = readFileSync(layoutPath, "utf8");

  test("app layout never pushes/replaces to /app/onboarding", () => {
    const stripped = layoutSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(stripped, "router.push to /app/onboarding has come back").not.toMatch(
      /router\s*\.\s*push\(\s*["'`]\/app\/onboarding/,
    );
    expect(stripped, "router.replace to /app/onboarding has come back").not.toMatch(
      /router\s*\.\s*replace\(\s*["'`]\/app\/onboarding/,
    );
    expect(stripped, "window.location to /app/onboarding has come back").not.toMatch(
      /location\s*\.\s*(?:href|assign|replace)\s*[=(]\s*["'`]\/app\/onboarding/,
    );
  });

  test("/app/onboarding redirects to the Business Genome intro tab", () => {
    const onboardingPath = resolve(__dirname, "../src/app/app/onboarding/page.tsx");
    const src = readFileSync(onboardingPath, "utf8");
    expect(src).toMatch(/redirect\s*\(\s*["'`]\/app\/profile\?tab=business-genome&intro=1["'`]\s*\)/);
  });

  test("/app/onboarding/business-os redirects to the Business Genome tab", () => {
    const path = resolve(__dirname, "../src/app/app/onboarding/business-os/page.tsx");
    const src = readFileSync(path, "utf8");
    expect(src).toMatch(/redirect\s*\(\s*["'`]\/app\/profile\?tab=business-genome["'`]\s*\)/);
  });

  test("/app/blueprint redirects to the Business Genome Advanced Editor", () => {
    const blueprintPath = resolve(__dirname, "../src/app/app/blueprint/page.tsx");
    const src = readFileSync(blueprintPath, "utf8");
    expect(src).toMatch(
      /redirect\s*\(\s*["'`]\/app\/profile\?tab=business-genome&section=advanced-editor["'`]\s*\)/,
    );
  });

  test("no file under apps/web/src navigates to /app/onboarding", () => {
    const srcRoot = resolve(__dirname, "../src");
    const onboardingPageFile = resolve(srcRoot, "app/app/onboarding/page.tsx");
    const onboardingBusinessOsFile = resolve(srcRoot, "app/app/onboarding/business-os/page.tsx");

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
        if (full === onboardingPageFile || full === onboardingBusinessOsFile) continue;
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
      `the following files navigate to /app/onboarding and could recreate a redirect loop:\n  - ${offenders.join("\n  - ")}`,
    ).toEqual([]);
  });
});
