/**
 * P237 FU-OPS-STATUS-SAVE-RACE (launch-track, D-315). Operations' store status toggle called
 * onConfigChange("storeSettings", { storeStatus }) and then onSaveConfig() in the same tick, and the hook's
 * handleSaveConfig sent the storefrontConfig of its own render: the status just chosen was not in what was saved, so
 * the saved storefront kept the old status. A status change now saves the config with the new status.
 * Real hook (useStoreData) and real OperationsMode, wired as the Store page wires them; only lib/client's reads and
 * writes, lib/api, the workspace and toasts are stubbed (the harness is use-store-data-r7.test.tsx's).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";

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

import { useStoreData } from "../../hooks/use-store-data";
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
