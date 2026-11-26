/**
 * CATALOG-1 web, round 4 (SEC-CAT-R3-1): when one of the selected business's own reads failed, what it would write is
 * off (useStoreData refuses the save; see hooks/__tests__/use-store-data-switch-r4.test.tsx), and the page says so,
 * naming the part that did not load, so a Save that does nothing is not a mystery. All three landed: no notice.
 * The store page is rendered for real with its data hooks and tab bodies stubbed (store-tab-deep-links' harness).
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
const flags = vi.hoisted(() => ({ canSaveBusiness: true, canSaveStorefront: true, canChangeListing: true }));
vi.mock("../hooks/use-store-data", () => ({
  useStoreData: () => ({
    loading: false, loadError: null, businessId: "biz_r4", storeEnabled: true,
    storefrontConfig: {}, businessData: { name: "Shop B" }, businessHours: {},
    commerceProducts: [{ id: "p1" }], services: [], activeDeliveryMethodsCount: 0, readiness: null, storeGraph: null,
    emitEvent: vi.fn(), loadData: vi.fn(), getPublicBookingUrl: () => "", toggleStoreEnabled: vi.fn(),
    ...flags,
  }),
}));
vi.mock("../components/store-header-actions", () => ({ StoreHeaderActions: () => null }));
vi.mock("../components/overview-mode", () => ({ OverviewMode: () => <div data-testid="body-overview-mode" /> }));
vi.mock("../components/design-mode", () => ({ DesignMode: () => <div data-testid="body-design-mode" /> }));
vi.mock("../components/merchandising-mode", () => ({ MerchandisingMode: () => <div data-testid="body-merchandising-mode" /> }));
vi.mock("../components/catalog-mode", () => ({ CatalogMode: () => <div data-testid="body-catalog-mode" /> }));
vi.mock("../components/operations-mode", () => ({ OperationsMode: () => <div data-testid="body-operations-mode" /> }));
vi.mock("../components/launch-mode", () => ({ LaunchMode: () => <div data-testid="body-launch-mode" /> }));

async function openStore() {
  nav.search = "";
  const { default: StorePage } = await import("@/app/app/store/page");
  render(<StorePage />);
  await screen.findAllByRole("tab");
}

beforeEach(() => {
  Object.assign(flags, { canSaveBusiness: true, canSaveStorefront: true, canChangeListing: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const notice = () => screen.queryByText(/did not load/i);

describe("a read of the selected business failed: the page says what cannot be saved", () => {
  it("the storefront read failed: the notice names the storefront settings", async () => {
    flags.canSaveStorefront = false;
    await openStore();
    expect(notice()?.textContent).toMatch(/storefront settings/i);
    expect(notice()?.textContent).not.toMatch(/business details|store listing/i);
    expect(notice()?.textContent).toMatch(/refresh/i);
  });

  it("the business read and the listing read failed: the notice names both", async () => {
    flags.canSaveBusiness = false;
    flags.canChangeListing = false;
    await openStore();
    expect(notice()?.textContent).toMatch(/business details/i);
    expect(notice()?.textContent).toMatch(/store listing/i);
  });

  it("control: every read landed, no notice", async () => {
    await openStore();
    expect(notice()).toBeNull();
  });
});
