/**
 * WEDGE-WA-INBOUND-CAPTURE (web half, D-263): "+ New > From WhatsApp" offers New quote for the customer it just found
 * or created, from any screen. The door is /app/commerce?tab=quotes&contactId=<id>: the Quotes tab opens with the New
 * quote sheet's customer chosen (the page hands the id to QuotesPanel as its prefill, which quotes-panel.tsx turns into
 * an open New quote form for that customer, as a contact's own "Create quote" does).
 *
 * Before this the page read ?contactId nowhere (only the retired use-commerce.ts did). The sheet reaches this door
 * with a full page load (new-from-whatsapp.tsx). When this was written, a client navigation (router.push) mounted the
 * page twice, because RequireAuth remounted the shell on every pathname change, and the first instance stripped the
 * id (review COR-1). FU-REQUIRE-AUTH-REMOUNT removed that remount, so the contacts screens' router.push doors to this
 * URL (a contact's Send quote, use-contact-actions.ts; the next-action Send quote, use-contacts-pipeline.ts) now open
 * the form too (FU-CONTACT-SEND-QUOTE-DOOR: contact-send-quote-door.test.tsx, e2e/sweep-contact-send-quote.spec.ts).
 *
 *   QFC-01 a fresh mount at ?tab=quotes&contactId=<id>: Quotes tab, prefill for that customer, and the id leaves the URL
 *          (a reload or Back does not open a second form).
 *   QFC-02 the door clicked while the page is mounted (the header's New is on every screen, Sales included).
 *   QFC-03 the legacy quotes door (?tab=pipeline&view=quotes&contactId=) does the same.
 *   QFC-04 guards: no contactId, no prefill; a contactId with a tab that is not Quotes is left alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/lib/navigation-context', () => ({
  useNavigationContext: () => ({ getOriginContext: () => null }),
}));
vi.mock('@/lib/use-return-navigation', () => ({
  useReturnNavigation: () => ({ getReturnLabel: () => 'Back', navigateBack: vi.fn() }),
}));
vi.mock('@/hooks/use-keyboard-shortcuts', () => ({ useKeyboardShortcuts: () => {} }));
// The app shell's composer provider, which the quotes panel's send reads.
vi.mock('@/components/email/compose-context', () => ({ useCompose: () => ({ open: () => {} }) }));
vi.mock('@/hooks/use-module-events', () => ({ useModuleEvent: () => {} }));
vi.mock('@/hooks/use-plan', () => ({ usePlan: () => ({ checkLimit: () => ({ allowed: true }) }) }));

vi.mock('@/components/guide/keyflow-unified-shell', () => ({
  KeyflowUnifiedShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
/** The tab strip, reduced to what the page passes it: the tabs and the active one. */
vi.mock('@/components/ui/workspace-shell', () => ({
  WorkspaceShell: ({
    tabs, activeTab, onTabChange, children,
  }: {
    tabs: Array<{ key: string; label: string }>;
    activeTab: string;
    onTabChange: (k: string) => void;
    children: React.ReactNode;
  }) => (
    <div data-testid="shell" data-active-tab={activeTab}>
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => onTabChange(t.key)}>{t.label}</button>
      ))}
      {children}
    </div>
  ),
}));
vi.mock('@/components/ui/skeleton', () => ({ ListPageSkeleton: () => <div>loading</div> }));
vi.mock('@/components/ui/workspace-error', () => ({ WorkspaceError: () => <div>error</div> }));
vi.mock('@/components/ui/mobile-action-sheet', () => ({ MobileActionSheet: () => null }));
vi.mock('@/components/layout/flow-quick-launcher', () => ({ FlowQuickLauncher: () => null }));

vi.mock('../hooks/use-commerce-shell', () => ({
  useCommerceShell: () => ({
    businessId: 'biz_1', businessCurrency: 'TTD',
    workspaceLoading: false, workspaceError: null,
    products: [], setProducts: vi.fn(),
    invoices: [], setInvoices: vi.fn(),
    quotes: [], setQuotes: vi.fn(),
    contacts: [], loading: false, error: null,
  }),
}));
// The real useBillingWorkspace: the prefill under test is its state.

/** The Quotes panel, reduced to the prefill the page hands it (quotes-panel.tsx opens New quote with it). */
vi.mock('../quotes/quotes-panel', () => ({
  default: ({ prefillContactId, prefillToken }: { prefillContactId?: string; prefillToken?: number }) => (
    <div data-testid="tab-quotes" data-prefill-contact={prefillContactId ?? ''} data-prefill-token={prefillToken ?? ''} />
  ),
}));
vi.mock('../payments/payments-tab', () => ({ default: () => <div data-testid="tab-collections" /> }));
vi.mock('../../finance/components/revenue-composer', () => ({ RevenueComposer: () => null }));
vi.mock('../recurring/recurring-panel', () => ({ default: () => <div data-testid="tab-recurring" /> }));
vi.mock('../components/commerce-overview-tab', () => ({
  CommerceOverviewTab: () => <div data-testid="tab-snapshot" />,
}));
vi.mock('../components/tab-frame', () => ({
  TabFrame: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../components/commerce-kpi-strip', () => ({ CommerceKpiStrip: () => null }));
vi.mock('../components/revenue-record-drawer', () => ({ RevenueRecordDrawer: () => null }));
vi.mock('../components/commerce-banners', () => ({ CommerceBanners: () => null }));
vi.mock('../components/commerce-header-right', () => ({ CommerceHeaderRight: () => null }));
vi.mock('../components/revenue-action-menu', () => ({ RevenueActionMenu: () => null }));
vi.mock('../components/standalone-payment-recorder', () => ({ StandalonePaymentRecorder: () => null }));

import CommercePage from '../page';

const quotesPanel = () => screen.getByTestId('tab-quotes');
const prefilled = () => quotesPanel().getAttribute('data-prefill-contact');
const activeTab = () => screen.getByTestId('shell').getAttribute('data-active-tab');
const urlParam = (k: string) => new URLSearchParams(window.location.search).get(k);

function openAt(url: string) {
  window.history.replaceState({}, '', url);
  return render(<CommercePage />);
}

function navigate(rerender: (ui: React.ReactElement) => void, url: string) {
  act(() => {
    window.history.pushState({}, '', url);
    rerender(<CommercePage />);
  });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/app/commerce');
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
});
afterEach(cleanup);

describe('New quote for a customer from another screen (?tab=quotes&contactId=)', () => {
  it('QFC-01 a fresh mount opens the Quotes tab with that customer chosen, and the id leaves the URL', () => {
    openAt('/app/commerce?tab=quotes&contactId=c_qfc_1');
    expect(activeTab()).toBe('quotes');
    expect(prefilled()).toBe('c_qfc_1');
    expect(urlParam('contactId')).toBeNull();
    expect(urlParam('tab')).toBe('quotes');
  });

  it('QFC-02 the door clicked while the page is mounted (from the Snapshot, then again for another customer)', () => {
    const { rerender } = openAt('/app/commerce');
    expect(activeTab()).toBe('snapshot');
    navigate(rerender, '/app/commerce?tab=quotes&contactId=c_qfc_2');
    expect(activeTab()).toBe('quotes');
    expect(prefilled()).toBe('c_qfc_2');
    expect(urlParam('contactId')).toBeNull();
    const first = quotesPanel().getAttribute('data-prefill-token');

    navigate(rerender, '/app/commerce?tab=quotes&contactId=c_qfc_3');
    expect(prefilled()).toBe('c_qfc_3');
    expect(quotesPanel().getAttribute('data-prefill-token')).not.toBe(first);
  });

  it('QFC-03 the legacy quotes door with a customer does the same', () => {
    openAt('/app/commerce?tab=pipeline&view=quotes&contactId=c_qfc_4');
    expect(activeTab()).toBe('quotes');
    expect(prefilled()).toBe('c_qfc_4');
    expect(urlParam('contactId')).toBeNull();
  });

  it('QFC-04 guards: no contactId opens no form; a contactId on another tab is left alone', () => {
    openAt('/app/commerce?tab=quotes');
    expect(prefilled()).toBe('');
    cleanup();

    openAt('/app/commerce?tab=collections&contactId=c_qfc_5');
    expect(activeTab()).toBe('collections');
    expect(screen.queryByTestId('tab-quotes')).toBeNull();
    expect(nav.router.push).not.toHaveBeenCalled();
  });
});
