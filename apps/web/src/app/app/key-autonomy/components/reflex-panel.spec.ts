/**
 * The autonomic switch.
 *
 * The whole loop existed and could not be started. AgentTriggerService installs
 * an events.onAny(...) firehose and queries agentTrigger for ENABLED rules;
 * DefaultTriggersService seeds 22 of them deliberately disabled, so that
 * creating a business never starts KEY acting on production data.
 *
 * There was then no screen to enable one. `fetchAgentTriggers` sat in
 * lib/client.ts with ZERO callers, so the planner, executor, BullMQ workers,
 * dispatcher and feedback loop were all live and permanently idle, waiting on
 * rows nobody could switch on.
 *
 * These assertions are structural because the value here is reachability — the
 * defect was never that the component misbehaved, it was that no component
 * existed and no caller reached the endpoint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const panel = readFileSync(join(__dirname, "reflex-panel.tsx"), "utf8");
const page = readFileSync(join(__dirname, "..", "page.tsx"), "utf8");
const client = readFileSync(
  join(__dirname, "..", "..", "..", "..", "lib", "client.ts"),
  "utf8",
);

describe("the switch exists and is reachable", () => {
  it("the panel is mounted on a real page", () => {
    // A component nobody renders is this repo's signature defect — 64 web
    // components were never rendered when last counted.
    expect(page).toMatch(/import \{ ReflexPanel \}/);
    expect(page).toMatch(/<ReflexPanel businessId=\{businessId\} \/>/);
  });

  it("it reads the triggers endpoint that had no callers", () => {
    expect(panel).toMatch(/fetchAgentTriggers\(businessId\)/);
  });

  it("it can actually WRITE — reading alone would still leave autonomy off", () => {
    expect(panel).toMatch(/updateAgentTrigger\(businessId, reflex\.id, \{ enabled: next \}\)/);
  });

  it("the update client function exists and targets the right route", () => {
    expect(client).toMatch(/export async function updateAgentTrigger/);
    expect(client).toMatch(/agent\/triggers\/\$\{encodeURIComponent\(triggerId\)\}/);
    expect(client).toMatch(/method: 'PUT'/);
  });

  it("sends auth headers — the route is guarded by AuthGuard and BusinessGuard", () => {
    const fn = client.slice(client.indexOf("export async function updateAgentTrigger"));
    expect(fn.slice(0, fn.indexOf("\n}"))).toMatch(/getAuthHeaders\(\)/);
  });
});

describe("enabling autonomy is a legible decision", () => {
  it("shows how many reflexes are live", () => {
    expect(panel).toMatch(/active/);
    expect(panel).toMatch(/r\.enabled\)\.length/);
  });

  it("warns when a reflex acts without approval", () => {
    // autoExecute means KEY acts unprompted up to its risk tier. That is the
    // single most consequential thing on this screen.
    expect(panel).toMatch(/acts without approval up to tier/);
  });

  it("marks the two patterns nothing emits", () => {
    // store_order.abandoned and content_request.approved have no emitter
    // anywhere in the server. Enabling one does nothing, and discovering that
    // by waiting is worse than being told.
    expect(panel).toMatch(/store_order\.abandoned/);
    expect(panel).toMatch(/content_request\.approved/);
    expect(panel).toMatch(/nothing emits this event yet/);
  });

  it("rolls back an optimistic toggle that failed", () => {
    // Leaving the switch showing "on" after the write failed would be a lie
    // about whether KEY is acting.
    expect(panel).toMatch(/enabled: !next/);
  });
});
