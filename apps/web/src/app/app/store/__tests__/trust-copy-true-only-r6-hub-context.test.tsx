/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 6 (R6-2), under D-303: the store page gives the AI hub, which writes
 * customer-facing copy from them, only the products live on the storefront, not every product in the catalog.
 *
 * The store page is rendered for real with its data hook and tab bodies stubbed (they are not under test; the hub
 * context is).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, waitFor } from "@testing-library/react";

const hub = vi.hoisted(() => ({ updateStoreContext: vi.fn() }));
const data = vi.hoisted(() => ({ live: new Set<string>(), products: [] as { id: string; isActive?: boolean }[], services: [] as { id: string; sourceProductId?: string | null }[] }));
const design = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/store",
  useSearchParams: () => new URLSearchParams(nav.search),
  useParams: () => ({}),
}));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ setCurrentMeta: vi.fn(), getOriginContext: () => null }) }));
vi.mock("@/lib/use-return-navigation", () => ({ useReturnNavigation: () => undefined }));
vi.mock("@/components/ui/resume-task-system", () => ({ ResumePrompt: () => null }));
vi.mock("@/components/keyflow/notes-trigger", () => ({ NotesTrigger: () => null }));
vi.mock("@/components/keyflow/page-notes-mount", () => ({ PageNotesMount: () => null }));
vi.mock("../hooks/use-store-ai-hub", () => ({ useStoreAiHub: () => hub }));
vi.mock("../hooks/use-store-data", () => ({
  useStoreData: () => ({
    loading: false, loadError: null, businessId: "biz_r6", storeEnabled: true,
    storefrontConfig: {}, businessData: { name: "Pepper Co" }, businessHours: {},
    commerceProducts: data.products, services: data.services, activeDeliveryMethodsCount: 0, readiness: null, storeGraph: null,
    liveProductIds: data.live,
    emitEvent: vi.fn(), loadData: vi.fn(), getPublicBookingUrl: () => "", toggleStoreEnabled: vi.fn(),
  }),
}));
vi.mock("../components/store-header-actions", () => ({ StoreHeaderActions: () => null }));
vi.mock("../components/overview-mode", () => ({ OverviewMode: () => null }));
vi.mock("../components/design-mode", () => ({ DesignMode: (p: Record<string, unknown>) => { design.props = p; return null; } }));
vi.mock("../components/merchandising-mode", () => ({ MerchandisingMode: () => null }));
vi.mock("../components/catalog-mode", () => ({ CatalogMode: () => null }));
vi.mock("../components/operations-mode", () => ({ OperationsMode: () => null }));
vi.mock("../components/launch-mode", () => ({ LaunchMode: () => null }));

afterEach(() => {
  cleanup();
  hub.updateStoreContext.mockReset();
});

const lastProducts = () => (hub.updateStoreContext.mock.calls.at(-1)?.[0] as { products: { id: string }[] }).products.map((p) => p.id);

describe("R6-2: the hub is given only the products live on the storefront", () => {
  it("12 products, none live: none", async () => {
    data.products = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));
    data.live = new Set();
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    expect(lastProducts()).toEqual([]);
  });

  it("12 products, 2 live and 1 live but inactive: the 2", async () => {
    data.products = [...Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` })), { id: "off", isActive: false }];
    data.live = new Set(["p3", "p7", "off"]);
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    expect(lastProducts()).toEqual(["p3", "p7"]);
  });
});

describe("R6B: the hub's services, and the Design tab's counts", () => {
  it("the hub is given only bookable services, not a product's store-listing service rows", async () => {
    data.products = [{ id: "p0" }];
    data.live = new Set(["p0"]);
    data.services = [{ id: "s1" }, { id: "s_l0", sourceProductId: "p0" }, { id: "s2", sourceProductId: null }];
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    const ctx = hub.updateStoreContext.mock.calls.at(-1)?.[0] as { services: { id: string }[] };
    expect(ctx.services.map((s) => s.id)).toEqual(["s1", "s2"]);
    data.services = [];
  });

  it("the Design tab is given the live product ids, so its AI Hero Copy panel can count what is live", async () => {
    data.products = [{ id: "p0" }, { id: "p1" }];
    data.live = new Set(["p1"]);
    nav.search = "tab=design";
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(design.props).not.toBeNull());
    expect(design.props?.liveProductIds).toBe(data.live);
    nav.search = "";
  });
});
