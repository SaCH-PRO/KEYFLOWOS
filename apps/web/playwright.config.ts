import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5000);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Live mode (R0-25-PLAYWRIGHT-R0): E2E_LIVE=1 drives the specs that mock
 * nothing (release0-live.spec.ts, live-journey.spec.ts) against a real API at
 * E2E_API_URL. The web server this config starts then points
 * NEXT_PUBLIC_API_BASE_URL at that API, with no Supabase URL or key, so the
 * browser has nothing to call off localhost. Without E2E_LIVE every spec runs
 * against `http://api.test.local`, which the mocked specs fulfil with
 * page.route() and the live specs skip.
 */
const LIVE = process.env.E2E_LIVE === "1";
const API_URL = process.env.E2E_API_URL ?? "http://localhost:3001";

/**
 * A pre-installed Chromium to launch instead of the one Playwright downloads
 * (for a sandbox whose browser cache does not hold this Playwright's build).
 * Unset in CI, where `playwright install` provides the browser.
 */
const CHROMIUM_EXECUTABLE = process.env.PW_CHROMIUM_EXECUTABLE?.trim() || undefined;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: LIVE ? 15_000 : 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI && !LIVE ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    // The live run keeps its trace whether it passes or fails: it is the
    // evidence the e2e-live workflow uploads.
    trace: LIVE ? "on" : "retain-on-failure",
    video: "retain-on-failure",
    // A dev server compiles each route on its first request, so the live run
    // waits longer for a page than the mocked one does.
    actionTimeout: LIVE ? 20_000 : 5_000,
    navigationTimeout: LIVE ? 180_000 : 15_000,
    // The app registers a service worker (`/sw.js`) that proxies every fetch
    // through its own `fetch(event.request)`. Playwright route handlers don't
    // intercept fetches issued from inside a SW, so any endpoint mocked by the
    // tests would silently miss once the SW activated. Blocking SWs at the
    // browser level keeps every request visible to `page.route(...)`.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(CHROMIUM_EXECUTABLE
          ? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] } }
          : {}),
      },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        // E2E_WEB_COMMAND serves a production build instead (e2e-live.yml runs
        // `next start` on a build made with the same NEXT_PUBLIC_* values).
        command: process.env.E2E_WEB_COMMAND ?? `next dev -H 0.0.0.0 -p ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: LIVE ? 300_000 : 120_000,
        env: LIVE
          ? {
              NEXT_PUBLIC_API_BASE_URL: API_URL,
              NEXT_PUBLIC_SUPABASE_URL: "",
              NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
              NEXT_PUBLIC_SITE_URL: "",
            }
          : {
              NEXT_PUBLIC_API_BASE_URL: "http://api.test.local",
            },
      },
});
