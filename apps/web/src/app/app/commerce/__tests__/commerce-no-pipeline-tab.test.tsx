/**
 * MOUNT-QUOTES (D-150 hubs): the pipeline leaves Sales for good, and every
 * stored or server-emitted pipeline link still opens a real screen.
 *
 * At main 9a7b5011 /app/commerce had three tabs, Snapshot, Pipeline and
 * Recurring; the Pipeline tab mounted FinancePipeline (quotes and invoices in
 * one list, with a Collections view), and the quotes panel kept current through
 * V1-51..V1-53b was mounted nowhere. The pipeline's bulk Status > Void deleted
 * quotes (BUG-033), its accepted quotes offered no Convert (BUG-003), its
 * drafts no Edit (BUG-045), and no row offered WhatsApp or Copy link (BUG-044).
 *
 * THE RULE: the Sales page's tabs are Snapshot, Quotes, Collections and
 * Recurring; the Quotes tab is quotes-panel.tsx; Collections is the
 * pipeline's collections view (PaymentsTab) on its own tab, so Sales keeps
 * what the hub ruling names (quotes, invoices, collections, cashflow); the
 * invoices live at /app/commerce/invoices. Legacy URLs land on a real screen:
 *   ?tab=pipeline (no view), ?tab=pipeline&view=quotes, ?tab=quotes  -> Quotes tab
 *   ?tab=pipeline&view=invoices, ?tab=invoices                        -> /app/commerce/invoices
 *   ?tab=pipeline&view=collections, ?tab=payments                      -> Collections tab
 *   ?quote=<id> (Money's activity feed)                                -> the quote's record drawer
 *
 *   NPT-01  RED-BEFORE  the tabs are Snapshot, Quotes, Collections, Recurring; none is named Pipeline
 *   NPT-02  RED-BEFORE  the three quote doors land on the Quotes tab, and the URL is rewritten to ?tab=quotes
 *   NPT-03  RED-BEFORE  the two invoice doors replace the route with /app/commerce/invoices
 *   NPT-04  RED-BEFORE  the two collections doors land on the Collections tab
 *   NPT-05  control     bare /app/commerce is the Snapshot; ?tab=recurring is Recurring; a tab click sticks
 *   NPT-06  RED-BEFORE  ?quote=<id> opens that quote's record drawer
 *   NPT-07  RED-BEFORE  a door arriving while mounted (Money > Quotes clicked from the Snapshot) switches the tab
 *
 * Every child the page composes is stubbed to a marker naming the tab it
 * belongs to (as commerce-tab-follows-url.test.tsx does): what is under test
 * is which tab the page chose and where it sent the browser, not the tabs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/lib/navigation-context", () => ({ useNavigationContext: () => ({ getOriginContext: () => null }) }));
vi.mock("@/lib/use-return-navigation", () => ({ useReturnNavigation: () => ({ getReturnLabel: () => "Back", navigateBack: vi.fn() }) }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({ useKeyboardShortcuts: () => {} }));
vi.mock("@/components/email/compose-context", () => ({ useCompose: () => ({ open: () => {} }) }));
vi.mock("@/hooks/use-module-events", () => ({ useModuleEvent: () => {}, useModuleEmit: () => vi.fn() }));
vi.mock("@/hooks/use-plan", () => ({ usePlan: () => ({ checkLimit: () => ({ allowed: true }) }) }));
vi.mock("@/components/guide/keyflow-unified-shell", () => ({
  KeyflowUnifiedShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/ui/workspace-shell", () => ({
  WorkspaceShell: ({ tabs, activeTab, onTabChange, children }: {
    tabs: Array<{ key: string; label: string }>; activeTab: string; onTabChange: (k: string) => void; children: React.ReactNode;
  }) => (
    <div data-testid="shell" data-active-tab={activeTab}>
      <div role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" type="button" onClick={() => onTabChange(t.key)}>{t.label}</button>
        ))}
      </div>
      {children}
    </div>
  ),
}));
vi.mock("@/components/ui/skeleton", () => ({ ListPageSkeleton: () => <div>loading</div> }));
vi.mock("@/components/ui/workspace-error", () => ({ WorkspaceError: () => <div>error</div> }));
vi.mock("@/components/ui/mobile-action-sheet", () => ({ MobileActionSheet: () => null }));
vi.mock("@/components/layout/flow-quick-launcher", () => ({ FlowQuickLauncher: () => null }));

const shellData = vi.hoisted(() => ({ invoices: [] as unknown[], quotes: [] as unknown[] }));
vi.mock("../hooks/use-commerce-shell", () => ({
  useCommerceShell: () => ({
    businessId: "biz_v1mq", businessCurrency: "TTD", workspaceLoading: false, workspaceError: null,
    products: [], setProducts: vi.fn(), invoices: shellData.invoices, setInvoices: vi.fn(),
    quotes: shellData.quotes, setQuotes: vi.fn(), contacts: [], loading: false, error: null,
  }),
}));
vi.mock("../hooks/use-billing-workspace", () => ({
  useBillingWorkspace: () => ({
    pendingPrefill: null, prefillForContact: vi.fn(), clearPrefill: vi.fn(),
    triggerNewQuote: 0, triggerNewInvoice: 0, triggerNewSchedule: 0,
    setTriggerNewQuote: vi.fn(), setTriggerNewInvoice: vi.fn(), setTriggerNewSchedule: vi.fn(),
  }),
}));
// The tabs' bodies, each a marker. The quotes panel and the collections view are what MOUNT-QUOTES mounts.
vi.mock("../quotes/quotes-panel", () => ({ default: () => <div data-testid="tab-quotes" /> }));
vi.mock("../payments/payments-tab", () => ({ default: () => <div data-testid="tab-collections" /> }));
vi.mock("../../finance/components/finance-pipeline", () => ({ FinancePipeline: () => <div data-testid="tab-pipeline" /> }));
vi.mock("../../finance/components/revenue-composer", () => ({ RevenueComposer: () => null }));
vi.mock("../recurring/recurring-panel", () => ({ default: () => <div data-testid="tab-recurring" /> }));
vi.mock("../components/commerce-overview-tab", () => ({ CommerceOverviewTab: () => <div data-testid="tab-snapshot" /> }));
vi.mock("../components/tab-frame", () => ({ TabFrame: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../components/commerce-kpi-strip", () => ({ CommerceKpiStrip: () => null }));
vi.mock("../components/revenue-record-drawer", () => ({
  RevenueRecordDrawer: ({ record }: { record: { entity: string; id: string } | null }) =>
    record ? <div data-testid="record-drawer">{record.entity}:{record.id}</div> : null,
}));
vi.mock("../components/commerce-banners", () => ({ CommerceBanners: () => null }));
vi.mock("../components/commerce-header-right", () => ({ CommerceHeaderRight: () => null }));
vi.mock("../components/revenue-action-menu", () => ({ RevenueActionMenu: () => null }));
vi.mock("../components/standalone-payment-recorder", () => ({ StandalonePaymentRecorder: () => null }));

import CommercePage from "../page";

const activeTab = () => screen.getByTestId("shell").getAttribute("data-active-tab");
const tabNames = () => screen.getAllByRole("tab").map((t) => t.textContent);
const shown = () => ["snapshot", "quotes", "collections", "recurring", "pipeline"].filter((t) => screen.queryByTestId(`tab-${t}`));
const url = () => {
  const p = new URLSearchParams(window.location.search);
  return { tab: p.get("tab"), view: p.get("view") };
};

function openAt(path: string) {
  window.history.replaceState({}, "", path);
  return render(<CommercePage />);
}
function navigate(rerender: (ui: React.ReactElement) => void, path: string) {
  act(() => {
    window.history.pushState({}, "", path);
    rerender(<CommercePage />);
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app/commerce");
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
  shellData.quotes = [];
  shellData.invoices = [];
});
afterEach(cleanup);

describe("MOUNT-QUOTES: no Pipeline tab on Sales; every pipeline door lands on a real screen", () => {
  it("NPT-01 RED-BEFORE: the tabs are Snapshot, Quotes, Collections and Recurring, none named Pipeline", () => {
    openAt("/app/commerce");
    expect(tabNames()).toEqual(["Snapshot", "Quotes", "Collections", "Recurring"]);
    expect(screen.queryByRole("tab", { name: /pipeline/i })).toBeNull();
  });

  it("NPT-02 RED-BEFORE: ?tab=pipeline, ?tab=pipeline&view=quotes and ?tab=quotes land on the Quotes tab (URL rewritten to ?tab=quotes)", () => {
    for (const door of ["/app/commerce?tab=pipeline", "/app/commerce?tab=pipeline&view=quotes", "/app/commerce?tab=quotes"]) {
      openAt(door);
      expect(activeTab(), door).toBe("quotes");
      expect(shown(), door).toEqual(["quotes"]);
      expect(url(), door).toEqual({ tab: "quotes", view: null });
      expect(nav.router.replace, door).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("NPT-03 RED-BEFORE: ?tab=pipeline&view=invoices and ?tab=invoices go to the Invoices list, /app/commerce/invoices", () => {
    for (const door of ["/app/commerce?tab=pipeline&view=invoices", "/app/commerce?tab=invoices"]) {
      openAt(door);
      expect(nav.router.replace, door).toHaveBeenCalledWith("/app/commerce/invoices");
      // Nothing of the pipeline renders meanwhile.
      expect(screen.queryByTestId("tab-pipeline"), door).toBeNull();
      nav.router.replace.mockClear();
      cleanup();
    }
  });

  it("NPT-04 RED-BEFORE: ?tab=pipeline&view=collections and ?tab=payments land on the Collections tab", () => {
    for (const door of ["/app/commerce?tab=pipeline&view=collections", "/app/commerce?tab=payments", "/app/commerce?tab=payments&surface=collections"]) {
      openAt(door);
      expect(activeTab(), door).toBe("collections");
      expect(shown(), door).toEqual(["collections"]);
      expect(url().tab, door).toBe("collections");
      cleanup();
    }
  });

  it("NPT-05 control: bare /app/commerce is the Snapshot, ?tab=recurring is Recurring, and a tab picked on the page sticks", () => {
    openAt("/app/commerce");
    expect(activeTab()).toBe("snapshot");
    expect(shown()).toEqual(["snapshot"]);
    cleanup();
    openAt("/app/commerce?tab=recurring");
    expect(activeTab()).toBe("recurring");
    fireEvent.click(screen.getByRole("tab", { name: "Quotes" }));
    expect(activeTab()).toBe("quotes");
    expect(url().tab).toBe("quotes");
    fireEvent.click(screen.getByRole("tab", { name: "Collections" }));
    expect(activeTab()).toBe("collections");
    expect(url().tab).toBe("collections");
  });

  it("NPT-06 RED-BEFORE: ?quote=<id> (Money's activity feed door) opens that quote's record drawer on the Quotes tab", () => {
    openAt("/app/commerce?tab=pipeline&quote=q_v1mq_7");
    expect(activeTab()).toBe("quotes");
    expect(screen.getByTestId("record-drawer").textContent).toBe("quote:q_v1mq_7");
  });

  it("NPT-07 RED-BEFORE: Money > Quotes clicked from the Snapshot while mounted switches to the Quotes tab; bare Sales returns to the Snapshot", () => {
    const { rerender } = openAt("/app/commerce");
    expect(activeTab()).toBe("snapshot");
    navigate(rerender, "/app/commerce?tab=pipeline&view=quotes");
    expect(activeTab()).toBe("quotes");
    expect(shown()).toEqual(["quotes"]);
    navigate(rerender, "/app/commerce");
    expect(activeTab()).toBe("snapshot");
  });
});
