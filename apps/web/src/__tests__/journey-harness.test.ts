/**
 * GATE-HARNESS: the journey gate harness's rules, pinned.
 *
 *   - playwright.config.ts runs the journeys (e2e/journeys/*.spec.ts) and
 *     e2e/release0-live.spec.ts in two projects, phone 375x812 and desktop
 *     1440x900; the mocked "chromium" project leaves the journey folder alone.
 *   - E2E_VARIANT names the API's variant (ai-disabled, key-disabled, ai-on);
 *     legs tagged @staging, @scheduler and @ai-on run only where their stack does.
 *   - The journeys refuse a dev server: the web must be `next build` output, so
 *     feature flags take production values.
 *   - The 3G load timing is a tracked budget, never pass/fail.
 *   - Under KEY_DISABLED every button or link naming KEY counts as KEY UI.
 *   - .github/workflows/e2e-live.yml runs both projects in the ai-disabled and
 *     key-disabled variants (ai-on only on dispatch, in its own environment),
 *     with release0-live.spec.ts in every variant, against the production build.
 *   - Review repair (SEC-GH-1, SEC-GH-2, GH-COR-2, GH-COR-1, GH-COR-4): every
 *     browser context a journey makes is watched, not only the owner's page
 *     (off-host, 5xx, and release0-live.spec.ts's "only the selected business"
 *     rule, ported); a customer's context starts with no session; Release 0's
 *     results and verdict stay apart from the journeys' RED report.
 *
 * The harness modules are loaded per test, so a missing one fails the cases
 * that need it and not the file.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type Settings = typeof import("../../e2e/journeys/harness-settings");

const WEB = path.resolve(__dirname, "../..");
const ROOT = path.resolve(WEB, "../..");
const SETTINGS = path.join(WEB, "e2e/journeys/harness-settings.ts");

async function settings(): Promise<Settings> {
  return (await import(/* @vite-ignore */ SETTINGS)) as Settings;
}

interface ProjectLike {
  name?: string;
  testMatch?: RegExp | string | Array<RegExp | string>;
  testIgnore?: RegExp | string | Array<RegExp | string>;
  grepInvert?: RegExp | RegExp[];
  use?: Record<string, unknown> & { viewport?: { width: number; height: number } | null };
}

async function playwrightProjects(env: Record<string, string | undefined> = {}): Promise<ProjectLike[]> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    // The config reads E2E_* when it loads: load it afresh under this environment.
    vi.resetModules();
    const mod = (await import(/* @vite-ignore */ path.join(WEB, "playwright.config.ts"))) as {
      default: { projects?: ProjectLike[] };
    };
    return mod.default.projects ?? [];
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const asList = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Whether a project's testMatch / testIgnore select a spec file (absolute path), as Playwright reads RegExps. */
function selects(project: ProjectLike, file: string, configMatch = /.*\.spec\.ts$/): boolean {
  const match = asList(project.testMatch).length ? asList(project.testMatch) : [configMatch];
  const ignore = asList(project.testIgnore);
  const hit = (p: RegExp | string) => (p instanceof RegExp ? p.test(file) : file.endsWith(p));
  return match.some(hit) && !ignore.some(hit);
}

const spec = (rel: string) => path.join(WEB, rel);

describe("GATE-HARNESS: Playwright projects", () => {
  it("defines a phone project at 375x812 (touch, mobile viewport) and a desktop project at 1440x900, both Chromium", async () => {
    const projects = await playwrightProjects();
    const phone = projects.find((p) => p.name === "phone");
    const desktop = projects.find((p) => p.name === "desktop");
    expect(phone?.use?.viewport, "phone viewport").toEqual({ width: 375, height: 812 });
    expect(phone?.use?.isMobile, "phone is a mobile viewport").toBe(true);
    expect(phone?.use?.hasTouch, "phone has touch").toBe(true);
    expect(desktop?.use?.viewport, "desktop viewport").toEqual({ width: 1440, height: 900 });
    for (const p of [phone, desktop]) expect(p?.use?.defaultBrowserType ?? "chromium").toBe("chromium");
  });

  it("runs every journey spec and release0-live.spec.ts in both projects, and no mocked spec", async () => {
    const projects = await playwrightProjects();
    for (const name of ["phone", "desktop"]) {
      const p = projects.find((x) => x.name === name);
      expect(p, name).toBeDefined();
      expect(selects(p!, spec("e2e/journeys/smoke.spec.ts")), `${name} runs e2e/journeys/smoke.spec.ts`).toBe(true);
      expect(selects(p!, spec("e2e/journeys/d-quote-deposit.spec.ts")), `${name} runs a journey spec`).toBe(true);
      expect(selects(p!, spec("e2e/release0-live.spec.ts")), `${name} runs release0-live.spec.ts`).toBe(true);
      expect(selects(p!, spec("e2e/public-flows.spec.ts")), `${name} does not run the mocked public-flows.spec.ts`).toBe(false);
      expect(selects(p!, spec("e2e/live-journey.spec.ts")), `${name} does not run live-journey.spec.ts`).toBe(false);
    }
  });

  it("keeps the mocked chromium project off the journey folder, with the mocked specs and release0-live by name unchanged", async () => {
    const chromium = (await playwrightProjects()).find((p) => p.name === "chromium");
    expect(chromium).toBeDefined();
    expect(selects(chromium!, spec("e2e/journeys/smoke.spec.ts")), "chromium leaves journeys to the journey projects").toBe(false);
    for (const f of ["e2e/onboarding-loop-regression.spec.ts", "e2e/auth-helpers.spec.ts", "e2e/public-flows.spec.ts", "e2e/release0-live.spec.ts"]) {
      expect(selects(chromium!, spec(f)), `chromium still runs ${f}`).toBe(true);
    }
  });

  it("leaves out @staging, @scheduler and @ai-on legs in a CI run, and runs @ai-on only in the ai-on variant", async () => {
    const titles = (tag: string) => `journey E › the customer pays on /pay/link with WiPay ${tag}`;
    const ci = (await playwrightProjects({ E2E_VARIANT: "key-disabled", E2E_STAGING: undefined, E2E_SCHEDULERS: undefined })).find(
      (p) => p.name === "phone",
    );
    const invert = asList(ci?.grepInvert);
    expect(invert.length, "CI runs exclude legs by tag").toBeGreaterThan(0);
    const excluded = (title: string) => invert.some((r) => r.test(title));
    expect(excluded(titles("@staging"))).toBe(true);
    expect(excluded(titles("@scheduler"))).toBe(true);
    expect(excluded(titles("@ai-on"))).toBe(true);
    expect(excluded(titles("")), "an untagged leg runs").toBe(false);
    expect(excluded(titles("@ai-online")), "a tag must stand alone").toBe(false);

    const aiOn = (await playwrightProjects({ E2E_VARIANT: "ai-on" })).find((p) => p.name === "desktop");
    const aiOnInvert = asList(aiOn?.grepInvert);
    expect(aiOnInvert.some((r) => r.test(titles("@ai-on"))), "ai-on runs @ai-on legs").toBe(false);
    expect(aiOnInvert.some((r) => r.test(titles("@staging"))), "ai-on still leaves @staging to the staging run").toBe(true);
  });
});

describe("GATE-HARNESS: variants and legs", () => {
  it("parses E2E_VARIANT: ai-disabled by default, key-disabled and ai-on by name, anything else refused", async () => {
    const s = await settings();
    expect(s.parseVariant(undefined)).toBe("ai-disabled");
    expect(s.parseVariant("")).toBe("ai-disabled");
    expect(s.parseVariant("key-disabled")).toBe("key-disabled");
    expect(s.parseVariant("ai-on")).toBe("ai-on");
    expect(() => s.parseVariant("KEY_DISABLED")).toThrow(/E2E_VARIANT must be one of/);
    expect(() => s.parseVariant("ai")).toThrow(/E2E_VARIANT must be one of/);
  });

  it("brings @staging and @scheduler legs back only with E2E_STAGING / E2E_SCHEDULERS", async () => {
    const s = await settings();
    expect(s.excludedLegTags({ variant: "ai-disabled", staging: false, schedulers: false })).toEqual(["@staging", "@scheduler", "@ai-on"]);
    expect(s.excludedLegTags({ variant: "ai-disabled", staging: true, schedulers: false })).toEqual(["@scheduler", "@ai-on"]);
    expect(s.excludedLegTags({ variant: "ai-on", staging: false, schedulers: true })).toEqual(["@staging"]);
    expect(s.legGrepInvert({ variant: "ai-on", staging: true, schedulers: true })).toBeUndefined();
    expect(s.legSelectionFromEnv({ E2E_VARIANT: "key-disabled", E2E_STAGING: "1", E2E_SCHEDULERS: "true" })).toEqual({
      variant: "key-disabled",
      staging: true,
      schedulers: true,
    });
    expect(s.legSelectionFromEnv({ E2E_STAGING: "yes" }).staging, "only 1 or true switch a flag on").toBe(false);
  });
});

describe("GATE-HARNESS: production build only", () => {
  // Captured from this app's /auth/login: `next build` served standalone, and `next dev`.
  const PROD =
    '<script>self.__next_f.push([1,"0:{\\"P\\":null,\\"c\\":[\\"\\",\\"auth\\",\\"login\\"],\\"q\\":\\"\\",\\"i\\":false,\\"f\\":[],\\"m\\":\\"$undefined\\",\\"G\\":[\\"$\\",\\"$undefined\\"],\\"s\\":false,\\"S\\":true,\\"h\\":\\"$undefined\\",\\"p\\":\\"$undefined\\",\\"d\\":\\"$undefined\\",\\"b\\":\\"MZ56C4El7soo7IoLvQHOW\\"}\\n"])</script>';
  const DEV =
    '<script src="/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts_11s69zh._.js" async=""></script>' +
    '<script>self.__next_f.push([1,"0:{\\"P\\":null,\\"p\\":\\"$undefined\\",\\"d\\":\\"$undefined\\",\\"b\\":\\"development\\"}\\n"])</script>';

  it("reads the build id a page names", async () => {
    const s = await settings();
    expect(s.nextBuildIdOf(PROD)).toBe("MZ56C4El7soo7IoLvQHOW");
    expect(s.nextBuildIdOf(DEV)).toBe("development");
    expect(s.nextBuildIdOf("<html><body>not next</body></html>")).toBeNull();
  });

  it("refuses next dev (build id development, a hot-reload client) and passes a next build page", async () => {
    const s = await settings();
    expect(s.devBuildSigns(PROD)).toEqual([]);
    const signs = s.devBuildSigns(DEV);
    expect(signs.join("; ")).toMatch(/development/);
    expect(signs.join("; ")).toMatch(/hot-reload/);
    expect(s.devBuildSigns("<html></html>").length, "a page with no build id is not taken as production").toBeGreaterThan(0);
  });
});

describe("GATE-HARNESS: 3G timing and KEY UI", () => {
  it("throttles to Chrome's 3G preset and tracks the 3 s budget without failing on it", async () => {
    const s = await settings();
    expect(s.THROTTLE_3G).toEqual({ offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 });
    expect(s.LOAD_BUDGET_MS).toBe(3000);
    const over = s.describeTiming({
      label: "today",
      url: "/app/command-center",
      project: "phone",
      viewport: { width: 375, height: 812 },
      network: "3G",
      readyMs: 9665,
      loadEventEndMs: 8084,
      budgetMs: 3000,
      overBudget: true,
    });
    expect(over).toMatch(/OVER the 3000 ms budget \(tracked, not pass\/fail\)/);
  });

  it("counts every visible button or link naming KEY, and the KEY drawer, as KEY UI; KEYFLOWOS and 'API keys' are not", async () => {
    const s = await settings();
    const names = (role: string) => s.KEY_UI.filter((m) => m.role === role).map((m) => m.name);
    const isKeyButton = (name: string) => names("button").some((r) => r.test(name));
    for (const door of ["Talk to KEY", "Ask KEY anything...", "Chat with KEY", "Ask KEY for opportunities"]) {
      expect(isKeyButton(door), door).toBe(true);
    }
    for (const notKey of ["KEYFLOWOS", "API keys", "Keyboard shortcuts", "Monkey"]) expect(isKeyButton(notKey), notKey).toBe(false);
    expect(names("link").some((r) => r.test("KEY"))).toBe(true);
    expect(names("heading").some((r) => r.test("KEY"))).toBe(true);
  });
});

describe("GATE-HARNESS: e2e-live.yml", () => {
  const WORKFLOW = path.join(ROOT, ".github/workflows/e2e-live.yml");
  type Step = {
    name?: string;
    id?: string;
    run?: string;
    uses?: string;
    if?: string;
    env?: Record<string, string>;
    with?: Record<string, string>;
    "continue-on-error"?: string | boolean;
  };
  type Job = { if?: string; environment?: string; strategy?: { matrix?: { variant?: string[] } }; env?: Record<string, string>; steps?: Step[] };

  async function workflow(): Promise<{
    text: string;
    doc: { on: Record<string, { inputs?: Record<string, { type?: string; default?: unknown }> }>; jobs: Record<string, Job> };
  }> {
    const { parseYaml } = (await import(/* @vite-ignore */ path.join(ROOT, "scripts/agent-control/lib/yaml.mjs"))) as {
      parseYaml: (text: string) => never;
    };
    const text = fs.readFileSync(WORKFLOW, "utf8");
    return { text, doc: parseYaml(text) };
  }
  const variantsOf = (job: Job): string[] => job.strategy?.matrix?.variant ?? (job.env?.E2E_VARIANT ? [job.env.E2E_VARIANT] : []);
  const stepRunning = (job: Job, re: RegExp) => (job.steps ?? []).filter((s) => re.test(s.run ?? ""));

  it("always runs the ai-disabled and key-disabled variants, and ai-on only on dispatch with ai_on, in the e2e-ai-on environment", async () => {
    const { doc } = await workflow();
    const jobs = Object.values(doc.jobs);
    const always = jobs.filter((j) => !j.if).flatMap(variantsOf);
    expect([...always].sort()).toEqual(["ai-disabled", "key-disabled"]);
    const aiOn = jobs.filter((j) => variantsOf(j).includes("ai-on"));
    expect(aiOn).toHaveLength(1);
    expect(aiOn[0].if).toMatch(/inputs\.ai_on/);
    expect(aiOn[0].environment).toBe("e2e-ai-on");
    expect(doc.on.workflow_dispatch?.inputs?.ai_on?.type).toBe("boolean");
  });

  it("starts the API with KEY_DISABLED=1 only for key-disabled, AI_DISABLED=1 outside ai-on, and a provider key only in ai-on", async () => {
    const { doc } = await workflow();
    for (const job of Object.values(doc.jobs)) {
      const start = stepRunning(job, /node dist\/main\.js/);
      expect(start, "one API start step").toHaveLength(1);
      const run = start[0].run ?? "";
      expect(run).toMatch(/env -i /);
      const variants = variantsOf(job);
      if (variants.includes("ai-on")) {
        expect(run).not.toMatch(/AI_DISABLED=1/);
        expect(run).not.toMatch(/KEY_DISABLED=1/);
        expect(run).toMatch(/AI_INTEGRATIONS_OPENAI_API_KEY="\$AI_ON_KEY"/);
        expect(start[0].env?.AI_ON_KEY).toMatch(/secrets\.E2E_AI_ON_OPENAI_API_KEY/);
      } else {
        expect(run).toMatch(/AI_DISABLED=1/);
        expect(run).toMatch(/key-disabled\) key_switch='KEY_DISABLED=1'/);
        expect(run).toMatch(/ai-disabled\) key_switch='KEY_DISABLED='/);
        expect(run).not.toMatch(/API_KEY|secrets\./);
      }
      expect(run).toMatch(/DISABLE_SCHEDULERS=1/);
    }
  });

  it("runs release0-live.spec.ts and the journeys on both projects, against the standalone production build, with no feature-flag override", async () => {
    const { doc } = await workflow();
    for (const job of Object.values(doc.jobs)) {
      const r0 = stepRunning(job, /playwright test e2e\/release0-live\.spec\.ts/);
      expect(r0, "the Release 0 live journey step").toHaveLength(1);
      expect(r0[0].run).toMatch(/--project=phone --project=desktop/);
      expect(r0[0].if ?? null, "the Release 0 step is unconditional").toBeNull();
      const journeys = stepRunning(job, /playwright test e2e\/journeys\/ /);
      expect(journeys, "the journey step").toHaveLength(1);
      expect(journeys[0].run).toMatch(/--project=phone --project=desktop/);
      for (const step of [...r0, ...journeys]) {
        expect(step.env?.E2E_LIVE).toBe("1");
        expect(step.env?.E2E_WEB_COMMAND).toBe("standalone");
      }
      const build = stepRunning(job, /pnpm run build/).find((s) => /apps\/web/.test(s.run ?? ""));
      expect(build?.run).toMatch(/NEXT_PUBLIC_FF_/);
      expect(Object.keys(build?.env ?? {}).filter((k) => k.startsWith("NEXT_PUBLIC_FF_"))).toEqual([]);
    }
  });

  // Review repair GH-COR-1: Playwright empties its output folder when a run
  // starts, so the journeys step deleted the Release 0 step's traces (the
  // R0-25 closedBy evidence) before the upload.
  const outputOf = (step: Step) => (step.run ?? "").match(/--output[= ](\S+)/)?.[1] ?? null;

  it("gives every Playwright step its own --output folder, and uploads Release 0's as its own artifact whatever happened", async () => {
    const { doc } = await workflow();
    for (const [name, job] of Object.entries(doc.jobs)) {
      const runs = stepRunning(job, /playwright test /);
      expect(runs.length, `${name}: Playwright steps`).toBeGreaterThanOrEqual(3);
      const outputs = runs.map(outputOf);
      expect(outputs.filter((o) => o === null), `${name}: every Playwright step names its --output`).toEqual([]);
      expect(new Set(outputs).size, `${name}: each Playwright step writes a folder of its own`).toBe(outputs.length);
      for (const o of outputs) expect(o, `${name}: outputs live under test-results/`).toMatch(/^test-results\/[a-z0-9-]+$/);
      const r0 = stepRunning(job, /playwright test e2e\/release0-live\.spec\.ts/)[0];
      const uploads = (job.steps ?? []).filter((s) => /actions\/upload-artifact/.test(s.uses ?? ""));
      const r0Upload = uploads.find((u) => (u.with?.path ?? "").split(/\s+/).includes(`apps/web/${outputOf(r0)}/`));
      expect(r0Upload, `${name}: an upload of apps/web/${outputOf(r0)}/`).toBeDefined();
      expect(r0Upload?.with?.name, `${name}: the Release 0 artifact keeps its name`).toMatch(/^release0-live-trace/);
      expect(r0Upload?.if, `${name}: uploaded whether the run passes or fails`).toMatch(/always\(\)/);
      // Each folder is uploaded somewhere.
      const uploaded = uploads.flatMap((u) => (u.with?.path ?? "").split(/\s+/));
      for (const o of outputs) expect(uploaded, `${name}: ${o} is uploaded`).toContain(`apps/web/${o}/`);
    }
  });

  // Review repair GH-COR-4: the journeys are RED by design until the packets
  // that fix them land, so they must not decide the job's verdict about Release 0.
  it("keeps the Release 0 verdict apart: release0-live never continues on error, the journeys report RED unless dispatched with journeys_required, and the summary names each verdict", async () => {
    const { doc } = await workflow();
    const input = doc.on.workflow_dispatch?.inputs?.journeys_required;
    expect(input?.type, "a journeys_required dispatch input").toBe("boolean");
    expect(input?.default, "journeys are a RED report by default (GATE-JOURNEY-RUN dispatches with journeys_required)").toBe(false);
    for (const [name, job] of Object.entries(doc.jobs)) {
      const r0 = stepRunning(job, /playwright test e2e\/release0-live\.spec\.ts/)[0];
      const harness = stepRunning(job, /playwright test e2e\/journeys\/harness-self-check\.spec\.ts/);
      const journeys = stepRunning(job, /playwright test e2e\/journeys\/ /)[0];
      expect(r0["continue-on-error"] ?? false, `${name}: Release 0 decides the job`).toBe(false);
      expect(harness, `${name}: the harness self-check runs as its own step`).toHaveLength(1);
      expect(harness[0]["continue-on-error"] ?? false, `${name}: the harness self-check decides the job`).toBe(false);
      expect(harness[0].run).toMatch(/--project=phone --project=desktop/);
      expect(harness[0].if, `${name}: the self-check runs even when Release 0 failed`).toMatch(/!cancelled\(\)/);
      expect(String(journeys["continue-on-error"]), `${name}: journeys continue on error unless required`).toMatch(
        /^\$\{\{\s*!\s*inputs\.journeys_required\s*\}\}$/,
      );
      expect(journeys.run, `${name}: the journeys' report leaves the self-check to its own step`).toMatch(/--grep-invert @harness/);
      const summary = (job.steps ?? []).find((s) => /GITHUB_STEP_SUMMARY/.test(s.run ?? ""));
      expect(summary, `${name}: a step writes the verdicts to the job summary`).toBeDefined();
      expect(summary?.if).toMatch(/always\(\)/);
      const env = JSON.stringify(summary?.env ?? {});
      for (const step of [r0, harness[0], journeys]) {
        expect(step.id, `${name}: "${step.name}" has an id`).toBeTruthy();
        expect(env, `${name}: the summary reads ${step.id}'s outcome`).toContain(`steps.${step.id}.outcome`);
      }
    }
  });
});

describe("GATE-HARNESS: every person's browser is watched (review SEC-GH-1, SEC-GH-2, GH-COR-2)", () => {
  const API = "http://localhost:3001";
  const call = (method: string, p: string, status: number) => ({ method, url: `${API}${p}`, status });

  it("names an API call that names a business other than the context's own, as release0-live.spec.ts does (callsNamingAnotherBusiness, ported)", async () => {
    const s = await settings();
    const calls = [
      call("GET", "/crm/businesses/biz_a/contacts", 200),
      call("GET", "/crm/businesses/biz_b/contacts", 403),
      call("GET", "/crm/businesses/biz_b/contacts", 403),
      call("GET", "/identity/businesses/slug/my-shop", 200),
      call("GET", "/identity/me", 200),
      call("GET", "/bookings/public/businesses/biz%5Fa/services", 200),
      call("POST", "/commerce/businesses/biz_c/invoices", 404),
    ];
    expect(s.callsNamingAnotherBusiness(calls, "biz_a")).toEqual([
      "403 GET /crm/businesses/biz_b/contacts",
      "404 POST /commerce/businesses/biz_c/invoices",
    ]);
    expect(s.callsNamingAnotherBusiness(calls, ["biz_a", "biz_b", "biz_c"])).toEqual([]);
  });

  it("reports what every watched context did, each under who did it: requests off localhost, 5xx, and another business named", async () => {
    const s = await settings();
    const findings = s.journeyWatchFindings([
      { who: "owner", businessIds: ["biz_a"], offHost: [], serverErrors: [], apiCalls: [call("GET", "/crm/businesses/biz_a/contacts", 200)] },
      {
        who: "customer 1",
        businessIds: ["biz_a"],
        offHost: ["GET https://fonts.googleapis.com/css2?family=Lato"],
        serverErrors: [],
        apiCalls: [call("GET", "/bookings/public/businesses/biz_a/services", 200)],
      },
      {
        who: "second tenant",
        businessIds: ["biz_b"],
        offHost: [],
        serverErrors: [`500 GET ${API}/x`],
        apiCalls: [call("GET", "/crm/businesses/biz_a/contacts", 403)],
      },
    ]);
    expect(findings.map(s.describeFinding)).toEqual([
      "customer 1: left localhost: GET https://fonts.googleapis.com/css2?family=Lato",
      `second tenant: 5xx: 500 GET ${API}/x`,
      "second tenant: named another business: 403 GET /crm/businesses/biz_a/contacts",
    ]);
  });

  it("fails a journey on every finding; only the harness self-check declares the findings it provokes, and each one must be raised", async () => {
    const s = await settings();
    const findings = [
      { kind: "left localhost", who: "customer 1", line: "GET https://offhost.invalid/customer" },
      { kind: "named another business", who: "owner", line: "403 GET /crm/businesses/biz_b/contacts" },
    ] as const;
    const none = s.sortFindings([...findings], []);
    expect(none.unexpected.map(s.describeFinding)).toEqual(findings.map(s.describeFinding));
    expect(none.missing).toEqual([]);
    const declared = s.sortFindings([...findings], [/^customer 1: left localhost: GET https:\/\/offhost\.invalid\/customer$/]);
    expect(declared.unexpected.map(s.describeFinding)).toEqual(["owner: named another business: 403 GET /crm/businesses/biz_b/contacts"]);
    expect(declared.missing).toEqual([]);
    const unraised = s.sortFindings([], [/^member: left localhost: /]);
    expect(unraised.missing).toEqual(["/^member: left localhost: /"]);
    expect(s.SELF_CHECK_SPEC.test(path.join(WEB, "e2e/journeys/harness-self-check.spec.ts"))).toBe(true);
    expect(s.SELF_CHECK_SPEC.test(path.join(WEB, "e2e/journeys/d-quote-deposit.spec.ts"))).toBe(false);
  });

  it("starts a customer's context from an explicit empty session, never the owner's (Playwright fills an omitted storageState from the test's)", async () => {
    const s = await settings();
    expect(s.anonymousStorageState()).toEqual({ cookies: [], origins: [] });
    expect(s.anonymousStorageState(), "a fresh object each time").not.toBe(s.anonymousStorageState());
  });

  it("tells spec authors to make other people's contexts through the harness, never a bare browser.newContext()", () => {
    const readme = fs.readFileSync(path.join(WEB, "e2e/journeys/README.md"), "utf8");
    const helpers = fs.readFileSync(path.join(WEB, "e2e/journeys/journey-helpers.ts"), "utf8");
    for (const [name, doc] of [["README.md", readme], ["journey-helpers.ts", helpers]] as const) {
      expect(doc, `${name} must not send a customer to a bare browser.newContext()`).not.toMatch(/anonymous\s+`?browser\.newContext\(\)/);
      expect(doc, `${name} must not make a member with freshTenant()`).not.toMatch(/member[^.]*freshTenant\(\)/);
    }
    for (const helper of ["anonymousContext(browser", "signedInContext(browser", "memberOf(request", "allowBusinessNamed("]) {
      expect(readme, `README.md documents ${helper}`).toContain(helper);
    }
  });
});
