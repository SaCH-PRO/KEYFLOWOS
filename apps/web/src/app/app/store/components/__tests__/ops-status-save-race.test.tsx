/**
 * P237 FU-OPS-STATUS-SAVE-RACE (launch-track, D-315). Operations' store status toggle called
 * onConfigChange("storeSettings", { storeStatus }) and then onSaveConfig() in the same tick, and the hook's
 * handleSaveConfig sent the storefrontConfig of its own render: the status just chosen was not in what was saved, so
 * the saved storefront kept the old status. A status change now saves the config with the new status.
 * Real hook (useStoreData) and real OperationsMode, wired as the Store page wires them; only lib/client's reads and
 * writes, lib/api, the workspace and toasts are stubbed (the harness is use-store-data-r7.test.tsx's).
 *
 * R1 (first review, 2 MINOR test gaps): R1-1 a change-and-save made for A after the page has switched to B sends
 * nothing (saveConfig's tenancy guard); R1-2 withConfigChange's three rules, pinned directly: "__root" merges at the
 * top, an array section (sections, faqEntries) is replaced, any other section is merged.
 *
 * R2 (D-331): R2-2 that late call also leaves B's own storefront config as it was (A's change is not applied to B's
 * local state); P280 the status toggle is disabled while a save is in flight, and a second press sends nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";

const A = "biz_A";
type Res<T> = { data: T | null; error: string | null };
const ok = <T,>(data: T): Res<T> => ({ data, error: null });
const failed = <T,>(): Res<T> => ({ data: null, error: "Internal server error" });

const ws = vi.hoisted(() => ({ businessId: "biz_A" }));
const client = vi.hoisted(() => ({
  getBusinessById: vi.fn(),
  updateBusiness: vi.fn(),
  fetchStorefrontConfig: vi.fn(),
  updateStorefrontConfig: vi.fn(),
  fetchServices: vi.fn(),
  fetchStaff: vi.fn(),
  fetchAllProducts: vi.fn(),
  fetchStoreGraph: vi.fn(),
  fetchStoreReadiness: vi.fn(),
  fetchStoreAnalytics: vi.fn(),
  backfillStoreLinks: vi.fn(),
}));
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/client")>()), ...client }));
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), apiGet: api.apiGet }));
vi.mock("@/lib/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace")>()),
  refreshWorkspace: vi.fn(() => Promise.resolve(ws.businessId)),
  getStoredBusinessId: vi.fn(() => ws.businessId),
}));
vi.mock("@/hooks/use-app-layout", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/hooks/use-app-layout")>()), useMemberModuleLevels: () => null }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// Panels of the Operations tab that read on their own; not what this pins.
vi.mock("../delivery-config-panel", () => ({ DeliveryConfigPanel: () => null }));
vi.mock("../shipping-zones-panel", () => ({ ShippingZonesPanel: () => null }));
vi.mock("../qualification-config", () => ({ QualificationConfig: () => null }));
vi.mock("../hours-editor", async (importOriginal) => ({ ...(await importOriginal<typeof import("../hours-editor")>()), HoursEditor: () => null }));

import { useStoreData, withConfigChange } from "../../hooks/use-store-data";
import type { StorefrontConfig } from "@/lib/client";
import { OperationsMode } from "../operations-mode";

/** The Operations tab as the Store page renders it (store/page.tsx). */
function Operations() {
  const s = useStoreData();
  if (s.loading || !s.businessId) return <p>loading</p>;
  return (
    <OperationsMode
      businessId={s.businessId}
      storeEnabled={s.storeEnabled}
      businessHours={s.businessHours}
      storefrontConfig={s.storefrontConfig}
      onConfigChange={s.handleConfigChange}
      onSaveConfig={s.handleSaveConfig}
      onConfigChangeAndSave={s.handleConfigChangeAndSave}
      configSaving={s.configSaving}
      onHoursChange={s.setBusinessHours}
      onSaveHours={s.handleSaveHours}
      hoursSaving={s.hoursSaving}
      onToggleStoreEnabled={s.toggleStoreEnabled}
      commerceProducts={s.commerceProducts}
    />
  );
}

let storeEnabled = true;
beforeEach(() => {
  ws.businessId = A;
  storeEnabled = true;
  window.localStorage.clear();
  client.getBusinessById.mockImplementation(async () => ok({ id: A, name: "Shop A", slug: "shop-a", businessHours: null, storeEnabled }));
  client.updateBusiness.mockImplementation(async (b: { storeEnabled?: boolean }) => ok({ id: A, storeEnabled: b.storeEnabled }));
  client.fetchStorefrontConfig.mockImplementation(async () =>
    ok({ hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {}, storeSettings: { storeStatus: "active", deliveryOptions: ["pickup"] } }));
  client.updateStorefrontConfig.mockImplementation(async (_b: string, cfg: unknown) => ok(cfg));
  client.fetchServices.mockImplementation(async () => ok([]));
  client.fetchStaff.mockImplementation(async () => ok([]));
  client.fetchAllProducts.mockImplementation(async () => ok([]));
  client.fetchStoreGraph.mockImplementation(async () => ok({ mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 0 }));
  client.fetchStoreReadiness.mockImplementation(async () => failed());
  client.fetchStoreAnalytics.mockImplementation(async () => failed());
  client.backfillStoreLinks.mockImplementation(async () => {});
  api.apiGet.mockImplementation(async () => ({ data: null, error: null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });

const savedStatus = () => {
  const calls = client.updateStorefrontConfig.mock.calls;
  return (calls.at(-1)?.[1] as { storeSettings?: { storeStatus?: string } } | undefined)?.storeSettings?.storeStatus;
};

describe("P237: a store status change saves the status just chosen", () => {
  it("Active -> Pause: the storefront config sent has storeStatus 'paused'", async () => {
    render(<Operations />);
    const pause = await screen.findByRole("button", { name: "Pause" });
    await act(async () => { fireEvent.click(pause); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    expect(client.updateStorefrontConfig.mock.calls.at(-1)?.[0]).toBe(A);
    expect(savedStatus(), "the save sent the status from before the change").toBe("paused");
  });
  it("the rest of the store settings are kept in what is saved (the new status is merged, not a reset)", async () => {
    render(<Operations />);
    const toggle = await screen.findByRole("button", { name: "Pause" }); // found outside act: act holds renders until it ends
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    const sent = client.updateStorefrontConfig.mock.calls.at(-1)?.[1] as { storeSettings?: Record<string, unknown> };
    expect(sent.storeSettings).toEqual({ storeStatus: "paused", deliveryOptions: ["pickup"] });
  });
  it("Paused -> Go Live: the config sent has storeStatus 'active', and the page then says Active", async () => {
    storeEnabled = false;
    client.fetchStorefrontConfig.mockImplementation(async () =>
      ok({ hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {}, storeSettings: { storeStatus: "paused" } }));
    render(<Operations />);
    // two "Go Live" when paused (the status card's and the suggestion's); both call handleStatusChange("active")
    const [toggle] = await screen.findAllByRole("button", { name: "Go Live" }); // found outside act: act holds renders
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    expect(savedStatus()).toBe("active");
    expect(await screen.findByText(/Store Status: Active/)).toBeTruthy();
  });
  it("control: one save per change (the status is not saved twice)", async () => {
    render(<Operations />);
    const toggle = await screen.findByRole("button", { name: "Pause" }); // found outside act: act holds renders until it ends
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1);
  });
});

describe("P237 R1-1: a change-and-save made for A after a switch to B sends nothing", () => {
  it("the handler captured while A was shown, called once B is shown: no storefront config is written", async () => {
    const hook = renderHook(() => useStoreData());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.businessId).toBe(A);
    const captured = hook.result.current.handleConfigChangeAndSave; // A's handler
    act(() => {
      ws.businessId = "biz_B";
      window.dispatchEvent(new CustomEvent("kf:business-changed", { detail: { businessId: "biz_B" } }));
    });
    await waitFor(() => expect(hook.result.current.businessId).toBe("biz_B"));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    client.updateStorefrontConfig.mockClear();
    const bBefore = JSON.stringify(hook.result.current.storefrontConfig);
    await act(async () => { await captured("storeSettings", { storeStatus: "paused" }); });
    expect(client.updateStorefrontConfig, "A's change was written after the page switched to B").not.toHaveBeenCalled();
    // R2-2: and B's own config, as shown, is not changed by A's late call
    expect(JSON.stringify(hook.result.current.storefrontConfig), "A's change was applied to B's storefront config").toBe(bBefore);
  });
});

describe("P237 R1-2: withConfigChange", () => {
  const base = {
    hero: { headline: "Hi", imageUrl: "x" },
    sections: [{ id: "s1" }, { id: "s2" }],
    faqEntries: [{ q: "old", a: "old" }],
    storeSettings: { storeStatus: "active", deliveryOptions: ["pickup"] },
  } as unknown as StorefrontConfig;
  it('"__root" merges the updates at the top level', () => {
    const next = withConfigChange(base, "__root", { seo: { title: "T" } }) as unknown as Record<string, unknown>;
    expect(next.seo).toEqual({ title: "T" });
    expect(next.hero).toEqual({ headline: "Hi", imageUrl: "x" });
  });
  for (const key of ["sections", "faqEntries"]) {
    it(`an array section (${key}) is replaced by the updates, not merged`, () => {
      const replacement = [{ id: "only" }] as unknown as Record<string, unknown>;
      const next = withConfigChange(base, key, replacement) as unknown as Record<string, unknown>;
      expect(next[key]).toEqual([{ id: "only" }]);
      expect(Array.isArray(next[key]), `${key} became an object`).toBe(true);
    });
  }
  it("any other section is merged: its other keys are kept", () => {
    const next = withConfigChange(base, "storeSettings", { storeStatus: "paused" }) as unknown as Record<string, unknown>;
    expect(next.storeSettings).toEqual({ storeStatus: "paused", deliveryOptions: ["pickup"] });
    expect(next.hero, "another section changed").toEqual({ headline: "Hi", imageUrl: "x" });
  });
  it("a section that did not exist is created", () => {
    const next = withConfigChange(base, "promotions", { banner: "Sale" }) as unknown as Record<string, unknown>;
    expect(next.promotions).toEqual({ banner: "Sale" });
  });
  it("the config passed in is not changed (a new object is returned)", () => {
    const before = JSON.stringify(base);
    withConfigChange(base, "storeSettings", { storeStatus: "paused" });
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("P237 R2 (P280): the status toggle waits for the save in flight", () => {
  it("while a save is in flight the toggle is disabled, and pressing it again sends no second save", async () => {
    let release!: (v: unknown) => void;
    client.updateStorefrontConfig.mockImplementation(() => new Promise((r) => { release = r; }));
    render(<Operations />);
    const pause = await screen.findByRole("button", { name: "Pause" });
    await act(async () => { fireEvent.click(pause); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1));
    const [toggle] = screen.getAllByRole("button", { name: /^(Pause|Go Live)$/ });
    expect(toggle, "the toggle can be pressed while its save is in flight").toBeDisabled();
    await act(async () => { fireEvent.click(toggle); });
    expect(client.updateStorefrontConfig, "a second status save was sent while the first was in flight").toHaveBeenCalledTimes(1);
    await act(async () => { release(ok({})); });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^(Pause|Go Live)$/ })[0]).toBeEnabled());
  });
  it("the Go Live suggestion, pressed while the status save is in flight, sends no second save (the handler refuses)", async () => {
    storeEnabled = false;
    client.fetchStorefrontConfig.mockImplementation(async () =>
      ok({ hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {}, storeSettings: { storeStatus: "paused" } }));
    // both writes held: the store stays offline, so the "Go Live" suggestion stays on screen
    client.updateBusiness.mockImplementation(() => new Promise(() => {}));
    client.updateStorefrontConfig.mockImplementation(() => new Promise(() => {}));
    render(<Operations />);
    const [statusCard] = await screen.findAllByRole("button", { name: "Go Live" });
    await act(async () => { fireEvent.click(statusCard); });
    await waitFor(() => expect(client.updateStorefrontConfig).toHaveBeenCalledTimes(1));
    const suggestion = screen.getAllByRole("button", { name: "Go Live" }).find((b) => b !== statusCard && !(b as HTMLButtonElement).disabled);
    expect(suggestion, "the Go Live suggestion is not on screen").toBeTruthy();
    await act(async () => { fireEvent.click(suggestion!); });
    expect(client.updateStorefrontConfig, "the suggestion sent a second status save mid-flight").toHaveBeenCalledTimes(1);
  });
});
