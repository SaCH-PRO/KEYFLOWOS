/**
 * CATALOG-1 web, round 7 (MIN-4): the bulk buttons were held off by catalog-manager's own state, so a tab change
 * during an Add all or Remove all remounted the catalog with both buttons enabled, and a second run could start.
 * The running flag is now Your page's store data's (useStoreData().bulkRunning), and the buttons follow it.
 * The harness is store-listing-refused-r6.test.tsx's, with the real Catalog tab.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

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
const store = vi.hoisted(() => ({ bulkRunning: false, onSelectAll: (() => {}) as () => void | Promise<void> }));
const products = [
  { id: "p1", name: "Item 1", price: 5, currency: "TTD", category: "PRODUCT", isActive: true },
  { id: "p2", name: "Item 2", price: 5, currency: "TTD", category: "PRODUCT", isActive: true },
];
vi.mock("../hooks/use-store-data", () => ({
  useStoreData: () => ({
    loading: false, loadError: null, businessId: "biz_r7", storeEnabled: true,
    storefrontConfig: {}, businessData: { name: "Shop" }, businessHours: {},
    commerceProducts: products, services: [], activeDeliveryMethodsCount: 0, readiness: null, storeGraph: null,
    liveProductIds: new Set(["p1"]), graphProductToServiceMap: new Map([["p1", "svc_p1"]]), storeItemCount: 1,
    processingItems: new Set(), confirmRemove: null, setConfirmRemove: vi.fn(),
    handleToggleStoreItem: vi.fn(), handleSelectAll: () => store.onSelectAll(), handleDeselectAll: vi.fn(),
    handleDeleteServiceFromStore: vi.fn(), setBusinessHours: vi.fn(), handleSaveHours: vi.fn(), hoursSaving: false,
    handleReorderProducts: vi.fn(), handleItemOverrideChange: vi.fn(), handleCategoryEmphasisChange: vi.fn(),
    emitEvent: vi.fn(), loadData: vi.fn(), getPublicBookingUrl: () => "", toggleStoreEnabled: vi.fn(),
    canSaveBusiness: true, canSaveStorefront: true, canChangeListing: true, listingRefused: false,
    bulkRunning: store.bulkRunning,
  }),
}));
vi.mock("../components/store-header-actions", () => ({ StoreHeaderActions: () => null }));
vi.mock("../components/overview-mode", () => ({ OverviewMode: () => <div data-testid="body-overview-mode" /> }));
vi.mock("../components/design-mode", () => ({ DesignMode: () => <div data-testid="body-design-mode" /> }));
vi.mock("../components/merchandising-mode", () => ({ MerchandisingMode: () => <div data-testid="body-merchandising-mode" /> }));
vi.mock("../components/operations-mode", () => ({ OperationsMode: () => <div data-testid="body-operations-mode" /> }));
vi.mock("../components/launch-mode", () => ({ LaunchMode: () => <div data-testid="body-launch-mode" /> }));

async function openCatalog() {
  nav.search = "tab=catalog";
  const { default: StorePage } = await import("@/app/app/store/page");
  render(<StorePage />);
  await screen.findByRole("button", { name: /^add all$/i });
}

/** Away to Design and back to Catalog: the catalog is unmounted and mounted again. */
async function tabAwayAndBack() {
  const tab = (name: RegExp) => screen.getAllByRole("tab").find((t) => name.test(t.textContent ?? ""))!;
  fireEvent.click(tab(/design/i));
  await screen.findByTestId("body-design-mode");
  expect(screen.queryByRole("button", { name: /add all/i }), "the catalog is still mounted").toBeNull();
  fireEvent.click(tab(/catalog/i));
  await screen.findByRole("button", { name: /add all/i });
}

beforeEach(() => {
  store.bulkRunning = false;
  store.onSelectAll = () => {};
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MIN-4: a tab change during a bulk run", () => {
  it("the catalog mounted again keeps Add all and Remove all disabled while the run goes on", async () => {
    const onSelectAll = vi.fn(() => {
      store.bulkRunning = true;
      return new Promise<void>(() => {});
    });
    store.onSelectAll = onSelectAll;
    await openCatalog();
    fireEvent.click(screen.getByRole("button", { name: /^add all$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm add all/i }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    await tabAwayAndBack();
    expect(screen.getByRole("button", { name: /add all/i }), "Add all enabled after the remount").toBeDisabled();
    expect(screen.getByRole("button", { name: /remove all/i }), "Remove all enabled after the remount").toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /add all/i }));
    fireEvent.click(screen.getByRole("button", { name: /add all/i }));
    expect(onSelectAll, "a second run started after the remount").toHaveBeenCalledTimes(1);
  });

  it("control: with no run going on, the catalog mounted again has both buttons enabled", async () => {
    await openCatalog();
    await tabAwayAndBack();
    expect(screen.getByRole("button", { name: /add all/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /remove all/i })).not.toBeDisabled();
  });
});
