/**
 * FU-CONTACT-SEND-QUOTE-DOOR (D-283; found by WEDGE-WA-INBOUND-CAPTURE's web half): a contact's "Send quote" opens the
 * New quote form with that customer chosen.
 *
 * The door is the pipeline contact card's quick action (contact-card.tsx -> pipeline-contact-list.tsx ->
 * useContactActions().handleQuickAction(id, "send-quote")). It pushed /app/commerce?tab=billing&segment=quotes&
 * contactId=<id>: the commerce page maps ?tab=billing to the Snapshot and reads ?contactId only on the Quotes tab, so it
 * opened no quote. The hook runs for real and its router.push is captured; the commerce page then mounts at the URL it
 * pushed, as Next mounts it after a client navigation (FU-REQUIRE-AUTH-REMOUNT: the shell no longer remounts, so the
 * page mounts once and reads the one-shot ?contactId).
 *
 *   CSQ-01 RED  Send quote pushes the Quotes door for that customer (?tab=quotes&contactId=<id>)
 *   CSQ-02 RED  the commerce page at that URL opens the Quotes tab with New quote prefilled for that customer
 *   CSQ-03 RED  an id with URL-reserved characters reaches the page whole (the id is encoded in the door)
 *   CSQ-04 ctrl the other quick actions are unchanged (invoice, booking, refer)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, cleanup } from '@testing-library/react';

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

import { useContactActions } from '@/app/app/crm/pipeline/hooks/use-contact-actions';
import CommercePage from '../page';

const activeTab = () => screen.getByTestId('shell').getAttribute('data-active-tab');
const prefilled = () => screen.getByTestId('tab-quotes').getAttribute('data-prefill-contact');
const urlParam = (k: string) => new URLSearchParams(window.location.search).get(k);

/** The contacts screen's hook, with nothing but the quick action under test in use. */
function sendQuoteFor(contactId: string, action: 'send-quote' | 'create-invoice' | 'book-appointment' | 'refer' = 'send-quote'): string {
  const { result, unmount } = renderHook(() =>
    useContactActions({
      businessId: 'biz_1',
      contacts: [],
      setContacts: () => {},
      selectedContactId: null,
      setSelectedContactId: () => {},
      contactDetail: null,
      setContactDetail: () => {},
      selectedIds: new Set<string>(),
      setSelectedIds: () => {},
      setSelectMode: () => {},
      setShowMobileDetail: () => {},
      loadContacts: async () => {},
      loadDetail: async () => {},
      loadFlowData: async () => {},
    }),
  );
  result.current.handleQuickAction(contactId, action);
  unmount();
  expect(nav.router.push).toHaveBeenCalledTimes(1);
  return nav.router.push.mock.calls[0][0] as string;
}

/** Next's client navigation to the pushed URL: the destination page mounts once at it. */
function arriveAt(href: string) {
  window.history.replaceState({}, '', href);
  return render(<CommercePage />);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/app/crm/pipeline');
  nav.router.replace.mockClear();
  nav.router.push.mockClear();
});
afterEach(cleanup);

describe("a contact's Send quote opens New quote for that customer", () => {
  it('CSQ-01 Send quote pushes the Quotes door for that customer', () => {
    const href = sendQuoteFor('c_csq_1');
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/app/commerce');
    expect(url.searchParams.get('tab')).toBe('quotes');
    expect(url.searchParams.get('contactId')).toBe('c_csq_1');
  });

  it('CSQ-02 the commerce page at that URL opens the Quotes tab with New quote prefilled for that customer', () => {
    const href = sendQuoteFor('c_csq_2');
    arriveAt(href);
    expect(activeTab()).toBe('quotes');
    expect(prefilled()).toBe('c_csq_2');
    // One-shot: the id leaves the URL, so a reload or Back opens no second form.
    expect(urlParam('contactId')).toBeNull();
    expect(urlParam('tab')).toBe('quotes');
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it('CSQ-03 an id with URL-reserved characters reaches the page whole', () => {
    const id = 'c_csq&tab=snapshot#x';
    const href = sendQuoteFor(id);
    arriveAt(href);
    expect(activeTab()).toBe('quotes');
    expect(prefilled()).toBe(id);
  });

  it('CSQ-04 control: the other quick actions are unchanged', () => {
    expect(sendQuoteFor('c_csq_4', 'create-invoice')).toBe('/app/commerce?tab=billing&segment=invoices&contactId=c_csq_4');
    nav.router.push.mockClear();
    expect(sendQuoteFor('c_csq_4', 'book-appointment')).toBe('/app/bookings?contactId=c_csq_4');
    nav.router.push.mockClear();
    expect(sendQuoteFor('c_csq_4', 'refer')).toBe('/app/crm/contacts/c_csq_4?action=refer');
  });
});
