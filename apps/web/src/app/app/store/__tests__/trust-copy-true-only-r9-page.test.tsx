/**
 * P231 TRUST-BADGES-TRUE-ONLY, repair round 9 (R9-2), under D-303: the store page gives the Catalog tab the
 * storefront's FAQ entries, so its reorder save (which writes the whole config) can warn about their placeholders.
 * The page is rendered for real with its data hook and tab bodies stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, cleanup, waitFor } from "@testing-library/react";

const seen = vi.hoisted(() => ({ catalog: null as null | Record<string, unknown> }));
const FAQ = vi.hoisted(() => [{ id: "a", question: "Refunds?", answer: "[your refund policy]", order: 0 }]);
const CONFIG = vi.hoisted(() => ({ faqEntries: FAQ }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/app/store",
  useSearchParams: () => new URLSearchParams("tab=catalog"),
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
    loading: false, loadError: null, businessId: "biz_r9", storeEnabled: true,
    storefrontConfig: CONFIG, businessData: { name: "Pepper Co" }, businessHours: {},
    commerceProducts: [{ id: "p1" }], services: [], activeDeliveryMethodsCount: 0, readiness: null, storeGraph: null,
    liveProductIds: new Set(), emitEvent: vi.fn(), loadData: vi.fn(), getPublicBookingUrl: () => "", toggleStoreEnabled: vi.fn(),
  }),
}));
vi.mock("../components/store-header-actions", () => ({ StoreHeaderActions: () => null }));
vi.mock("../components/overview-mode", () => ({ OverviewMode: () => null }));
vi.mock("../components/design-mode", () => ({ DesignMode: () => null }));
vi.mock("../components/merchandising-mode", () => ({ MerchandisingMode: () => null }));
vi.mock("../components/catalog-mode", () => ({ CatalogMode: (p: Record<string, unknown>) => { seen.catalog = p; return null; } }));
vi.mock("../components/operations-mode", () => ({ OperationsMode: () => null }));
vi.mock("../components/launch-mode", () => ({ LaunchMode: () => null }));

afterEach(() => cleanup());

describe("R9-2: the Catalog tab is given the FAQ entries", () => {
  it("the store page passes the storefront's faqEntries to the Catalog tab", async () => {
    const { default: StorePage } = await import("@/app/app/store/page");
    render(<StorePage />);
    await waitFor(() => expect(seen.catalog).not.toBeNull());
    expect(seen.catalog?.faqEntries).toBe(FAQ);
  });
});
