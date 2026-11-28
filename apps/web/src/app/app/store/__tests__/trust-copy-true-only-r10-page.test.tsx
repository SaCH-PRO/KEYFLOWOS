/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 10 (MAJOR), under D-303: with the store graph not read (still loading,
 * failed, or refused: storeGraph null, liveProductIds empty), the store page tells the hub that what is live is not
 * known (storeProducts null), so the hub says nothing about what is on the store, and its copy counts no product,
 * rather than "2 items are on your store but not showing" for 2 products live on /book.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, waitFor } from "@testing-library/react";

const hub = vi.hoisted(() => ({ updateStoreContext: vi.fn() }));
const data = vi.hoisted(() => ({ graph: null as null | Record<string, unknown> }));
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
    loading: false, loadError: null, businessId: "biz_r10", storeEnabled: true,
    storefrontConfig: STABLE.config, businessData: STABLE.business, businessHours: STABLE.hours,
    commerceProducts: STABLE.products, services: STABLE.services, activeDeliveryMethodsCount: 0, readiness: null,
    storeGraph: data.graph, liveProductIds: STABLE.live, stockByProduct: null,
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

const { generateStoreSuggestions } = await vi.importActual<typeof import("../hooks/use-store-ai-hub")>("../hooks/use-store-ai-hub");

afterEach(() => {
  cleanup();
  hub.updateStoreContext.mockReset();
});

type Ctx = { products: unknown[]; storeProducts: unknown; storeServices: { id: string }[] };
const last = () => hub.updateStoreContext.mock.calls.at(-1)?.[0] as Ctx;

describe("R10-M: the store graph not read", () => {
  it("storeProducts is null (not known), the bookable services are still given, the catalog still goes to the analysis", async () => {
    data.graph = null;
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    expect(last().storeProducts).toBeNull();
    expect(last().storeServices.map((s) => s.id)).toEqual(["s_book"]);
    expect(last().products).toHaveLength(2);
  });

  it("read, with nothing live: storeProducts is [] (known to be empty)", async () => {
    data.graph = { mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 2, totalServices: 3, serviceNameIndex: {} };
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    expect(last().storeProducts).toEqual([]);
  });

  it("the hub, given that context, says nothing about what is on the store", async () => {
    data.graph = null;
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(hub.updateStoreContext).toHaveBeenCalled());
    const ctx = last() as unknown as Record<string, unknown>;
    const out = await generateStoreSuggestions({ businessId: "biz_r10", activeView: "catalog", customData: { ...ctx, storeServices: [], storeEnabled: true, hasHeroHeadline: true, hasHeroCta: true } } as never);
    expect(out.map((s) => s.title)).not.toContain("Nothing on Your Store Yet");
    expect(JSON.stringify(out)).not.toMatch(/not showing|not on your store/);
  });
});
