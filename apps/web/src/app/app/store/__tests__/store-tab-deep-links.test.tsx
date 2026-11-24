/**
 * NAV-A3 (sweep BUG-078): store tab links land where they say. (BUG-108, the Launch Pad's Storefront tile, is
 * pinned in app/app/command-center/__tests__/launch-pad-storefront.test.tsx.)
 *
 *   - BUG-078: the app links /app/store?tab=products (Schedule's catalog and performance views, Studio) and
 *     /app/store?tab=orders (Presence > Orders), but the store's tabs are overview, design, merchandising, catalog,
 *     operations and launch, so both landed on Overview. Products live on Catalog; orders on Ops (OrdersPanel).
 *
 * The store page is rendered for real with its data hooks and tab bodies stubbed (they are not under test; the
 * selected tab is). Cases tagged RED-BEFORE fail on the packet's base (f6764f4c); CONTROL cases pass on both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

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
vi.mock("../hooks/use-store-ai-hub", () => ({ useStoreAiHub: () => ({ updateStoreContext: vi.fn() }) }));
vi.mock("../hooks/use-store-data", () => ({
  useStoreData: () => ({
    loading: false, loadError: null, businessId: "biz_a3", storeEnabled: true,
    storefrontConfig: {}, businessData: { name: "Shanice's Salon" }, businessHours: {},
    commerceProducts: [{ id: "p1" }], services: [], activeDeliveryMethodsCount: 0, readiness: null, storeGraph: null,
    emitEvent: vi.fn(), loadData: vi.fn(), getPublicBookingUrl: () => "", toggleStoreEnabled: vi.fn(),
  }),
}));
vi.mock("../components/store-header-actions", () => ({ StoreHeaderActions: () => null }));
for (const [file, name] of [
  ["overview-mode", "OverviewMode"], ["design-mode", "DesignMode"], ["merchandising-mode", "MerchandisingMode"],
  ["catalog-mode", "CatalogMode"], ["operations-mode", "OperationsMode"], ["launch-mode", "LaunchMode"],
] as const) {
  vi.doMock(`../components/${file}`, () => ({ [name]: () => <div data-testid={`body-${file}`} /> }));
}

async function openStore(search: string) {
  nav.search = search;
  const { default: StorePage } = await import("@/app/app/store/page");
  render(<StorePage />);
  const tabs = await screen.findAllByRole("tab");
  return { tabs, selected: () => tabs.filter((t) => t.getAttribute("aria-selected") === "true").map((t) => (t.textContent ?? "").trim()) };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NAV-A3: store tab links land on that tab (BUG-078)", () => {
  it("RED-BEFORE: ?tab=products opens Catalog, where the products are", async () => {
    const { selected } = await openStore("tab=products");
    expect(selected()).toEqual(["Catalog"]);
    expect(screen.getByTestId("body-catalog-mode")).toBeTruthy();
  });

  it("RED-BEFORE: ?tab=orders opens Ops, where the orders are", async () => {
    const { selected } = await openStore("tab=orders");
    expect(selected()).toEqual(["Ops"]);
    expect(screen.getByTestId("body-operations-mode")).toBeTruthy();
  });

  it("CONTROL: a tab's own key opens it (?tab=design)", async () => {
    const { selected } = await openStore("tab=design");
    expect(selected()).toEqual(["Design"]);
  });

  it("CONTROL: an unknown tab opens Overview", async () => {
    const { selected } = await openStore("tab=nonsense");
    expect(selected()).toEqual(["Overview"]);
  });
});
