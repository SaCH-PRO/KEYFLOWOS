/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 7, under D-303: the store page gives the AI hub the whole catalog for its
 * analysis tools and what the storefront shows for its copy tools, and follows a product switched off or put live.
 *
 *   R7-3  products and services: the whole catalog (Pricing, Missing Images, Empty Catalog read them);
 *         storeProducts and storeServices: what /book shows
 *   R7-6  the context follows what the counts read: a product switched off, or put live, updates storeProducts, even
 *         when nothing else the effect watched changes
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, waitFor } from "@testing-library/react";

const hub = vi.hoisted(() => ({ updateStoreContext: vi.fn() }));
// Stable objects, as the real store data hook keeps them between renders: only what a test changes changes.
const data = vi.hoisted(() => ({
  live: new Set<string>(),
  products: [] as { id: string; name?: string; category?: string; isActive?: boolean }[],
  services: [] as { id: string; name?: string; sourceProductId?: string | null }[],
  config: {},
  business: { name: "Pepper Co" },
  hours: {},
}));
// r10: the store graph was read (a null graph means "not read", and then nothing is said about what is live).
const GRAPH = vi.hoisted(() => ({ mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 0, totalServices: 0, serviceNameIndex: {} }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/store",
  useSearchParams: () => new URLSearchParams(""),
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
    loading: false, loadError: null, businessId: "biz_r7", storeEnabled: true,
    storefrontConfig: data.config, businessData: data.business, businessHours: data.hours,
    commerceProducts: data.products, services: data.services, activeDeliveryMethodsCount: 0, readiness: null, storeGraph: GRAPH,
    liveProductIds: data.live, stockByProduct: null,
    emitEvent: vi.fn(), loadData: vi.fn(), getPublicBookingUrl: () => "", toggleStoreEnabled: vi.fn(),
  }),
}));
vi.mock("../components/store-header-actions", () => ({ StoreHeaderActions: () => null }));
vi.mock("../components/overview-mode", () => ({ OverviewMode: () => null }));
vi.mock("../components/design-mode", () => ({ DesignMode: () => null }));
vi.mock("../components/merchandising-mode", () => ({ MerchandisingMode: () => null }));
vi.mock("../components/catalog-mode", () => ({ CatalogMode: () => null }));
vi.mock("../components/operations-mode", () => ({ OperationsMode: () => null }));
vi.mock("../components/launch-mode", () => ({ LaunchMode: () => null }));

afterEach(() => {
  cleanup();
  hub.updateStoreContext.mockReset();
});

type Ctx = { products: { id: string }[]; services: { id: string }[]; storeProducts: { id: string }[]; storeServices: { id: string }[] };
const last = () => hub.updateStoreContext.mock.calls.at(-1)?.[0] as Ctx;
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe("R7-3: the whole catalog for the analysis, what the storefront shows for the copy", () => {
  it("12 products, 2 live, a bookable service and a listing row", async () => {
    data.products = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, category: "PRODUCT" }));
    data.live = new Set(["p3", "p7"]);
    data.services = [{ id: "s1", name: "Tasting" }, { id: "s_l3", sourceProductId: "p3" }];
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    expect(ids(last().products)).toHaveLength(12);
    expect(ids(last().services)).toEqual(["s1", "s_l3"]);
    expect(ids(last().storeProducts)).toEqual(["p3", "p7"]);
    expect(ids(last().storeServices)).toEqual(["s1"]);
  });
});

describe("R7-6: the hub context follows a product switched off or put live", () => {
  it("switched off: storeProducts drops it; put live: storeProducts gains it", async () => {
    data.products = [{ id: "p0", category: "PRODUCT" }, { id: "p1", category: "PRODUCT" }];
    data.live = new Set(["p0", "p1"]);
    data.services = [];
    const { default: StorePage } = await import("@/app/app/store/page");
    const view = render(<StorePage />);
    await waitFor(() => expect(ids(last()?.storeProducts ?? [])).toEqual(["p0", "p1"]));
    data.products = [{ id: "p0", category: "PRODUCT", isActive: false }, { id: "p1", category: "PRODUCT" }];
    view.rerender(<StorePage />);
    await waitFor(() => expect(ids(last().storeProducts)).toEqual(["p1"]));
    data.live = new Set(["p1"]);
    data.products = [{ id: "p0", category: "PRODUCT" }, { id: "p1", category: "PRODUCT" }];
    view.rerender(<StorePage />);
    await waitFor(() => expect(ids(last().storeProducts)).toEqual(["p1"]));
    data.live = new Set(["p0", "p1"]);
    view.rerender(<StorePage />);
    await waitFor(() => expect(ids(last().storeProducts)).toEqual(["p0", "p1"]));
  });
});
