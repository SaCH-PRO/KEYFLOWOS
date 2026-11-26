/**
 * CATALOG-1 web, round 5 (COR-R4-2): the store listing read (GET store/graph) refused with 403 is a permission
 * refusal: a member with the storefront module but no revenue read (the server's guard on that route). The page
 * still cannot change the listing (useStoreData refuses it), and says so plainly as a permission matter, without
 * the round 4 "did not load ... Refresh the page" advice, which a refresh can never satisfy.
 * The harness is store-reads-failed-r4.test.tsx's.
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
const flags = vi.hoisted(() => ({ canSaveBusiness: true, canSaveStorefront: true, canChangeListing: true, listingRefused: false }));
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
  Object.assign(flags, { canSaveBusiness: true, canSaveStorefront: true, canChangeListing: true, listingRefused: false });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const statuses = () => screen.queryAllByRole("status").map((el) => el.textContent ?? "");

describe("COR-R4-2: the store listing was refused (403)", () => {
  it("the page says it is a permission refusal, with no refresh advice", async () => {
    flags.canChangeListing = false;
    flags.listingRefused = true;
    await openStore();
    const said = statuses().join(" | ");
    expect(said).toMatch(/permission/i);
    expect(said).toMatch(/store listing/i);
    expect(said).not.toMatch(/refresh/i);
    expect(said).not.toMatch(/did not load/i);
  });

  it("refused listing and a failed storefront read: the failed read keeps its refresh advice, the listing does not", async () => {
    flags.canChangeListing = false;
    flags.listingRefused = true;
    flags.canSaveStorefront = false;
    await openStore();
    const failed = statuses().find((t) => /did not load/i.test(t)) ?? "";
    expect(failed).toMatch(/storefront settings/i);
    expect(failed).not.toMatch(/store listing/i);
    expect(statuses().find((t) => /permission/i.test(t)) ?? "").toMatch(/store listing/i);
  });

  it("control: the listing read failed otherwise (not refused): the round 4 notice with refresh advice", async () => {
    flags.canChangeListing = false;
    await openStore();
    const said = statuses().join(" | ");
    expect(said).toMatch(/store listing/i);
    expect(said).toMatch(/refresh/i);
    expect(said).not.toMatch(/permission/i);
  });
});
