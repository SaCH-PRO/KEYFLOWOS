/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 11 (R11-M, R11-1), under D-303: the store page tells the hub, and the
 * Design and Merchandising tabs, what is not known: the products when the store graph or the storefront config was
 * not read, the services when the config was not read.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, waitFor } from "@testing-library/react";

const hub = vi.hoisted(() => ({ updateStoreContext: vi.fn() }));
const data = vi.hoisted(() => ({ graph: null as null | Record<string, unknown>, configRead: true }));
const seen = vi.hoisted(() => ({ design: null as null | Record<string, unknown>, merch: null as null | Record<string, unknown>, search: "" }));
const STABLE = vi.hoisted(() => ({
  config: {},
  business: { name: "Pepper Co" },
  hours: {},
  products: [{ id: "p1", name: "Sauce", category: "PRODUCT" }, { id: "p2", name: "Rub", category: "PRODUCT" }],
  services: [{ id: "s_l1", sourceProductId: "p1" }, { id: "s_l2", sourceProductId: "p2" }, { id: "s_book", name: "Tasting" }],
  live: new Set<string>(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/store",
  useSearchParams: () => new URLSearchParams(seen.search),
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
    loading: false, loadError: null, businessId: "biz_r10", storeEnabled: true,
    storefrontConfig: STABLE.config, storefrontConfigRead: data.configRead, businessData: STABLE.business, businessHours: STABLE.hours,
    commerceProducts: STABLE.products, services: STABLE.services, activeDeliveryMethodsCount: 0, readiness: null,
    storeGraph: data.graph, liveProductIds: STABLE.live, stockByProduct: null,
    emitEvent: vi.fn(), loadData: vi.fn(), getPublicBookingUrl: () => "", toggleStoreEnabled: vi.fn(),
  }),
}));
vi.mock("../components/store-header-actions", () => ({ StoreHeaderActions: () => null }));
vi.mock("../components/overview-mode", () => ({ OverviewMode: () => null }));
vi.mock("../components/design-mode", () => ({ DesignMode: (pr: Record<string, unknown>) => { seen.design = pr; return null; } }));
vi.mock("../components/merchandising-mode", () => ({ MerchandisingMode: (pr: Record<string, unknown>) => { seen.merch = pr; return null; } }));
vi.mock("../components/catalog-mode", () => ({ CatalogMode: () => null }));
vi.mock("../components/operations-mode", () => ({ OperationsMode: () => null }));
vi.mock("../components/launch-mode", () => ({ LaunchMode: () => null }));


afterEach(() => {
  cleanup();
  hub.updateStoreContext.mockReset();
});

type Ctx = { products: unknown[]; storeProducts: unknown; storeServices: { id: string }[] };
const last = () => hub.updateStoreContext.mock.calls.at(-1)?.[0] as Ctx;

const GRAPH = { mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 2, totalServices: 3, serviceNameIndex: {} };

describe("R11: the store page's not-known views", () => {
  it("config not read: storeProducts and storeServices null", async () => {
    data.graph = GRAPH;
    data.configRead = false;
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    expect(last().storeProducts).toBeNull();
    expect(last().storeServices).toBeNull();
    data.configRead = true;
  });

  it("graph read and config read: both known", async () => {
    data.graph = GRAPH;
    data.configRead = true;
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    expect(last().storeProducts).toEqual([]);
    expect(last().storeServices.map((s) => s.id)).toEqual(["s_book"]);
  });

  for (const [tab, key] of [["design", "design"], ["merchandising", "merch"]] as const) {
    it(`the ${tab} tab is given the store view: graph not read, then config not read`, async () => {
      const props = () => seen[key] as Record<string, unknown> | null;
      seen.search = `tab=${tab}`;
      const { default: StorePage } = await import("@/app/app/store/page");
      data.graph = null;
      data.configRead = true;
      render(<StorePage />);
      await waitFor(() => expect(props()).not.toBeNull());
      expect(props()?.storeView).toEqual({ productsKnown: false, servicesKnown: true });
      cleanup();
      seen[key] = null;
      data.graph = GRAPH;
      data.configRead = false;
      render(<StorePage />);
      await waitFor(() => expect(props()).not.toBeNull());
      expect(props()?.storeView).toEqual({ productsKnown: false, servicesKnown: false });
      cleanup();
      seen[key] = null;
      data.configRead = true;
      render(<StorePage />);
      await waitFor(() => expect(props()).not.toBeNull());
      expect(props()?.storeView).toEqual({ productsKnown: true, servicesKnown: true });
      seen.search = "";
      data.graph = null;
    });
  }
});
