/**
 * GATE-HARNESS: the journey gate's settings, with no Playwright runtime import,
 * so playwright.config.ts, the journey fixtures (journey-helpers.ts) and the
 * web unit test that pins them (src/__tests__/journey-harness.test.ts) read one
 * source. README.md in this folder is the operator's view of the same rules.
 */

// ── env variants ──────────────────────────────────────────────────────────

/**
 * The three ways the API runs under the journeys (E2E_VARIANT):
 *
 *   ai-disabled   today's harness (e2e-live.yml before GATE-HARNESS): AI_DISABLED=1
 *                 and no AI provider key, so every AI call answers the R0-07 503
 *                 provider_not_configured.
 *   key-disabled  the same plus KEY_DISABLED=1 (D-17): the API refuses every model
 *                 dispatch with reason key_disabled, and no KEY UI may render.
 *   ai-on         AI on with a capped test key. Staging only, under the operator's
 *                 authority for provider traffic: e2e-live.yml runs it only when
 *                 dispatched with ai_on and approved through its environment.
 */
export type JourneyVariant = "ai-disabled" | "key-disabled" | "ai-on";
export const JOURNEY_VARIANTS: readonly JourneyVariant[] = ["ai-disabled", "key-disabled", "ai-on"];

/** E2E_VARIANT, defaulting to today's harness; any other value is refused, never guessed. */
export function parseVariant(raw: string | undefined): JourneyVariant {
  const value = (raw ?? "").trim();
  if (value === "") return "ai-disabled";
  if ((JOURNEY_VARIANTS as readonly string[]).includes(value)) return value as JourneyVariant;
  throw new Error(`E2E_VARIANT must be one of ${JOURNEY_VARIANTS.join(", ")}; got "${value}"`);
}

/** "1" or "true" (any case) switches an E2E_* flag on; anything else leaves it off. */
export function envFlag(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}

// ── projects ──────────────────────────────────────────────────────────────

/** The two journey projects: a phone and a desktop, each a Chromium page. */
export const JOURNEY_VIEWPORTS = {
  phone: { width: 375, height: 812 },
  desktop: { width: 1440, height: 900 },
} as const;
export type JourneyProject = keyof typeof JOURNEY_VIEWPORTS;
export const JOURNEY_PROJECTS = Object.keys(JOURNEY_VIEWPORTS) as JourneyProject[];

/**
 * What the journey projects run: every spec in e2e/journeys/, and the Release 0
 * live journey (e2e/release0-live.spec.ts, closedBy evidence), which runs here
 * as it is, unedited.
 */
export const JOURNEY_TEST_MATCH = /[\\/]e2e[\\/](?:journeys[\\/][^\\/]+\.spec\.ts|release0-live\.spec\.ts)$/;

/** The journey folder: the mocked "chromium" project leaves it to the journey projects. */
export const JOURNEYS_DIR = /[\\/]e2e[\\/]journeys[\\/]/;

// ── legs that need more than the CI stack ─────────────────────────────────

/**
 * A journey leg that needs something the CI stack does not have is its own test,
 * tagged ({ tag: "@staging" }):
 *
 *   @staging    a provider sandbox on the staging stack (Supabase sign-up, WiPay, Gmail, push)
 *   @scheduler  the schedulers and a controlled clock (GATE-SCHEDULER-RUN)
 *   @ai-on      AI on with a capped key (the ai-on variant, staging only)
 *
 * Each runs only where its stack does: E2E_STAGING=1, E2E_SCHEDULERS=1, E2E_VARIANT=ai-on.
 */
export const LEG_TAGS = ["@staging", "@scheduler", "@ai-on"] as const;
export type LegTag = (typeof LEG_TAGS)[number];

export interface LegSelection {
  variant: JourneyVariant;
  staging: boolean;
  schedulers: boolean;
}

/** The leg tags this run leaves out. */
export function excludedLegTags(selection: LegSelection): LegTag[] {
  const out: LegTag[] = [];
  if (!selection.staging) out.push("@staging");
  if (!selection.schedulers) out.push("@scheduler");
  if (selection.variant !== "ai-on") out.push("@ai-on");
  return out;
}

/**
 * The journey projects' grepInvert: a test carrying an excluded tag. Playwright
 * matches it against the title path followed by the test's tags, space-joined,
 * so a tag must stand alone ("@ai-online" is not "@ai-on").
 */
export function legGrepInvert(selection: LegSelection): RegExp | undefined {
  const tags = excludedLegTags(selection);
  if (tags.length === 0) return undefined;
  return new RegExp(`(?:^|\\s)(?:${tags.map((t) => t.replace(/[-]/g, "\\-")).join("|")})(?=\\s|$)`);
}

/** The selection a process's environment asks for. */
export function legSelectionFromEnv(env: Record<string, string | undefined>): LegSelection {
  return {
    variant: parseVariant(env.E2E_VARIANT),
    staging: envFlag(env.E2E_STAGING),
    schedulers: envFlag(env.E2E_SCHEDULERS),
  };
}

// ── production build ──────────────────────────────────────────────────────

/**
 * The build id a Next.js App Router page names in its flight data
 * (self.__next_f, `"b":"<id>"`, escaped inside the script string). `next dev`
 * names "development"; `next build` names the id it wrote to .next/BUILD_ID.
 */
export function nextBuildIdOf(html: string): string | null {
  const m = html.match(/\\?"b\\?"\s*:\s*\\?"([A-Za-z0-9_-]+)\\?"/);
  return m ? m[1] : null;
}

/**
 * Why a page's HTML is not from a production build, or [] when it is. The
 * journeys run against `next build` output so the dormant-feature flags take
 * their production values (src/lib/feature-flags.ts: every dormant module OFF
 * when NODE_ENV is production); a dev server turns them all on.
 */
export function devBuildSigns(html: string): string[] {
  const signs: string[] = [];
  const id = nextBuildIdOf(html);
  if (id === null) signs.push("the page names no Next.js build id (not a Next.js App Router page?)");
  else if (id === "development") signs.push('the page names build id "development" (next dev)');
  if (/react-refresh|hmr-client|webpack-hmr|turbopack-hmr|__nextDevClientId/i.test(html)) {
    signs.push("the page loads a hot-reload client (next dev)");
  }
  return signs;
}

// ── 3G load timing (tracked budget, not pass/fail) ────────────────────────

/**
 * Chrome DevTools' "3G" network preset (named "Fast 3G" before Chrome 120),
 * in the units CDP Network.emulateNetworkConditions takes: bytes per second
 * and milliseconds.
 */
export const THROTTLE_3G = Object.freeze({
  offline: false,
  latency: 150 * 3.75,
  downloadThroughput: ((1.6 * 1000 * 1000) / 8) * 0.9,
  uploadThroughput: ((750 * 1000) / 8) * 0.9,
});

/** Journey I: load time at 375px on throttled 3G is tracked against this budget. */
export const LOAD_BUDGET_MS = 3000;

export interface LoadTiming {
  label: string;
  url: string;
  project: string;
  viewport: { width: number; height: number } | null;
  network: "3G" | "unthrottled";
  /** Navigation start to the ready condition the spec names (e.g. Today's heading visible). */
  readyMs: number;
  /** PerformanceNavigationTiming.loadEventEnd, when the browser reported it. */
  loadEventEndMs: number | null;
  budgetMs: number;
  overBudget: boolean;
}

/** One line for the run's output: the figure and where it stands against the budget. */
export function describeTiming(t: LoadTiming): string {
  const verdict = t.overBudget ? `OVER the ${t.budgetMs} ms budget` : `within the ${t.budgetMs} ms budget`;
  const load = t.loadEventEndMs === null ? "" : `, load event ${Math.round(t.loadEventEndMs)} ms`;
  return `${t.label} (${t.project}, ${t.network}): ready in ${Math.round(t.readyMs)} ms${load}; ${verdict} (tracked, not pass/fail)`;
}

// ── KEY UI ────────────────────────────────────────────────────────────────

/**
 * KEY UI, by role and accessible name: under KEY_DISABLED none may render
 * (journey K, KEY-off; SWP-KEY-SHELL-SMOKE). Any visible button or link whose
 * name has KEY as a word (the KEY bubble "Talk to KEY", the header's "Ask
 * KEY", Today's "Chat with KEY", "Ask KEY for opportunities", a nav link to
 * KEY) is a KEY door; the brand KEYFLOWOS is not. The KEY chat drawer is found
 * by its heading. Case-sensitive on purpose: "API keys" is not KEY.
 */
export const KEY_UI: ReadonlyArray<{ what: string; role: "button" | "link" | "heading"; name: RegExp }> = [
  { what: "a button naming KEY", role: "button", name: /\bKEY\b/ },
  { what: "a link naming KEY", role: "link", name: /\bKEY\b/ },
  { what: "the KEY chat drawer (KeyChatPanel)", role: "heading", name: /^KEY$/ },
];

/** A fixture name with the run's prefix, for rows found later by prefix (README: fixtures). */
export const JOURNEY_PREFIX = "v62j_";
