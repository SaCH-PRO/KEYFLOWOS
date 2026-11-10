/**
 * W9-GOOGLE-WEB-403 (owner ruling D-99; review CR-W8GCO-1; was it.todo
 * [V94D-T04] in apps/server/test/google-consent-owner.integration.test.ts):
 * every Google connection of a business is started, synced and disconnected
 * only by the business owner. The server answers anyone else (an ADMIN or a
 * STAFF member) 403 {code:'GOOGLE_CONNECT_OWNER_ONLY'} on GET
 * /drive/businesses/:b/auth-url and DELETE /drive/businesses/:b/disconnect
 * (W8-GOOGLE-CONSENT-OWNER), and on the Google Suite connector doors POST
 * /connectors/businesses/:b/sync/:type, .../disconnect/:type and
 * .../reconnect/:type (W9-GOOGLE-DOORS-SERVER, [V94D-T02]).
 *
 * The defect: the web ignored that refusal on the Drive doors.
 *   - google-drive-browser.tsx handleDisconnect cleared the connection (the
 *     account, the files, the Disconnect button) as if Drive were disconnected,
 *     although the server had refused and the business's Drive stays connected;
 *   - google-drive-browser.tsx handleConnect, sheets-manage-drawer.tsx
 *     handleConnectDrive and inventory-command-center.tsx onConnectDrive showed
 *     nothing at all: the button did nothing.
 * Each now shows the server's refusal, as core-channels-section.tsx does with
 * its toast, and keeps the connection shown as it was.
 *
 * The Key Connect connector card (Sync now, Disconnect), the Integration
 * Health table (Reconnect, Disconnect) and the Google Contacts sync settings
 * (Sync now) already showed the server's message with a toast: those cases are
 * regression pins, green on the base with no source change.
 *
 * Mounted on the real components and the real api client (lib/api.ts); only
 * `fetch`, the toast and next/navigation are stubbed. The stubbed consent URLs
 * are same-document fragments, so a navigation is observable in jsdom.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock.toast, Toaster: () => null }));
const { toast } = toastMock;

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(),
    refresh: vi.fn(), prefetch: vi.fn(),
  }),
  usePathname: () => "/app/key-connect",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

import GoogleDriveBrowser from "../profile/components/google-drive-browser";
import { SheetsManageDrawer } from "../key-connect/components/sheets/sheets-manage-drawer";
import { InventoryCommandCenter } from "../marketplace/components/inventory-command-center";
import { ConnectorHealthSection } from "../key-connect/components/connector-health-section";
import { ContactSyncSettings } from "../key-connect/components/contact-sync-settings";
import KeyConnectPage from "../key-connect/page";

const BUSINESS = "biz_1";
const DRIVE = `/drive/businesses/${BUSINESS}`;
const CONNECTORS = `/connectors/businesses/${BUSINESS}`;
/** The server's refusal text (google-suite.controller.ts, GOOGLE_CONNECT_OWNER_ONLY_MESSAGE). */
const OWNER_ONLY_MESSAGE = "Only the business owner can connect, sync or disconnect a Google service for this business";
const DRIVE_ACCOUNT = "owner@drive.example.test";
const DRIVE_FILE = "Spring price list";

function jsonResponse(status: number, body: unknown, statusText = "OK"): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => (text ? (JSON.parse(text) as unknown) : null),
    text: async () => text,
    clone() { return this; },
  } as unknown as Response;
}

/** The production filter's body for the D-99 owner-only refusal (http-exception.filter.ts). */
function ownerOnly(path: string) {
  return jsonResponse(403, {
    statusCode: 403, code: "GOOGLE_CONNECT_OWNER_ONLY",
    message: OWNER_ONLY_MESSAGE, error: "Forbidden",
    timestamp: "2026-11-10T00:00:00.000Z", path,
  }, "Forbidden");
}

interface Call { method: string; pathname: string }

function stubServer(route: (method: string, pathname: string) => Response | undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, pathname });
    return route(method, pathname) ?? jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return calls;
}

const called = (calls: Call[], method: string, pathname: string) =>
  calls.filter((c) => c.method === method && c.pathname.endsWith(pathname));

/** A consent URL jsdom can navigate to: this document with a fragment naming it. */
const consentUrl = (tag: string) => `${window.location.origin}${window.location.pathname}#${tag}`;

/** The Drive browser's server: connected or not, one file, and the two owner-only doors. */
function driveBrowserServer(opts: { connected: boolean; disconnect?: () => Response; authUrl?: () => Response }) {
  return stubServer((method, pathname) => {
    if (method === "GET" && pathname.endsWith(`${DRIVE}/status`)) {
      return jsonResponse(200, opts.connected ? { connected: true, email: DRIVE_ACCOUNT } : { connected: false });
    }
    if (method === "GET" && pathname.endsWith(`${DRIVE}/files`)) {
      return jsonResponse(200, { files: [{ id: "file_1", name: DRIVE_FILE, mimeType: "application/vnd.google-apps.spreadsheet" }] });
    }
    if (method === "DELETE" && pathname.endsWith(`${DRIVE}/disconnect`) && opts.disconnect) return opts.disconnect();
    if (method === "GET" && pathname.endsWith(`${DRIVE}/auth-url`) && opts.authUrl) return opts.authUrl();
    return undefined;
  });
}

/** The inventory sheet's server: Drive not connected, and the consent URL refused or granted. */
function sheetServer(authUrl: () => Response) {
  return stubServer((method, pathname) => {
    if (method === "GET" && pathname.endsWith(`${DRIVE}/inventory-sheet/status`)) return jsonResponse(200, { connected: false });
    if (method === "GET" && pathname.endsWith(`${DRIVE}/auth-url`)) return authUrl();
    return undefined;
  });
}

function renderInventoryCommandCenter() {
  return render(
    <InventoryCommandCenter
      businessId={BUSINESS}
      basePath={`/marketplace/businesses/${BUSINESS}`}
      warehouses={[]}
      inventory={[]}
      products={[]}
      purchaseOrders={[]}
      onCreateWarehouse={() => {}}
      onEditWarehouse={() => {}}
      onDeleteWarehouse={() => {}}
      onAddInventory={() => {}}
      onCreatePO={() => {}}
      onEditPO={() => {}}
      onRefresh={() => {}}
    />,
  );
}

const NOT_CONNECTED_BANNER = "Connect your Google Drive account to enable Sheets sync";

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/app/profile");
  window.localStorage.setItem("kf_business_id", BUSINESS);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("W9-GOOGLE-WEB-403 (D-99): a Google Drive owner-only refusal is shown and the Drive connection stays as it was", () => {
  it("[V94D-T04] (W9-GOOGLE-WEB-403, was it.todo; D-99) RED-BEFORE: Google Drive browser, an ADMIN or STAFF member's Disconnect refused with 403 GOOGLE_CONNECT_OWNER_ONLY shows the server's refusal and keeps the Drive connection shown as connected (account, files and Disconnect stay)", async () => {
    const calls = driveBrowserServer({ connected: true, disconnect: () => ownerOnly(`${DRIVE}/disconnect`) });
    render(<GoogleDriveBrowser businessId={BUSINESS} />);

    expect(await screen.findByText(DRIVE_FILE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_MESSAGE));
    expect(called(calls, "DELETE", `${DRIVE}/disconnect`)).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Disconnect" })).not.toBeDisabled());
    expect(screen.getByText(DRIVE_FILE)).toBeInTheDocument();
    expect(screen.getByText(`(${DRIVE_ACCOUNT})`)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connect Google Drive" })).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("[V94D-T04] (W9-GOOGLE-WEB-403, was it.todo; D-99) RED-BEFORE: Google Drive browser, an ADMIN or STAFF member's Connect Google Drive refused with 403 GOOGLE_CONNECT_OWNER_ONLY shows the server's refusal, goes nowhere and stays on the connect card", async () => {
    const calls = driveBrowserServer({ connected: false, authUrl: () => ownerOnly(`${DRIVE}/auth-url`) });
    render(<GoogleDriveBrowser businessId={BUSINESS} />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_MESSAGE));
    expect(called(calls, "GET", `${DRIVE}/auth-url`)).toHaveLength(1);
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(screen.getByRole("button", { name: "Connect Google Drive" })).not.toBeDisabled());
    expect(screen.getByRole("heading", { name: "Connect Google Drive" })).toBeInTheDocument();
  });

  it("[V94D-T04] (W9-GOOGLE-WEB-403, was it.todo; D-99) RED-BEFORE: Key Connect Google Sheets drawer, an ADMIN or STAFF member's Connect Google Drive refused with 403 GOOGLE_CONNECT_OWNER_ONLY shows the server's refusal, goes nowhere and keeps Drive shown as not connected", async () => {
    const calls = sheetServer(() => ownerOnly(`${DRIVE}/auth-url`));
    render(<SheetsManageDrawer businessId={BUSINESS} />);

    expect(await screen.findByText(NOT_CONNECTED_BANNER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Drive" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_MESSAGE));
    expect(called(calls, "GET", `${DRIVE}/auth-url`)).toHaveLength(1);
    expect(window.location.hash).toBe("");
    expect(screen.getByText(NOT_CONNECTED_BANNER)).toBeInTheDocument();
    expect(screen.queryByText("Google Drive connected")).not.toBeInTheDocument();
  });

  it("[V94D-T04] (W9-GOOGLE-WEB-403, was it.todo; D-99) RED-BEFORE: inventory command center Spreadsheets tab, an ADMIN or STAFF member's Connect Google Drive refused with 403 GOOGLE_CONNECT_OWNER_ONLY shows the server's refusal, goes nowhere and keeps Drive shown as not connected", async () => {
    const calls = sheetServer(() => ownerOnly(`${DRIVE}/auth-url`));
    renderInventoryCommandCenter();

    fireEvent.click(screen.getByRole("button", { name: /Spreadsheets/ }));
    expect(await screen.findByText(NOT_CONNECTED_BANNER)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Connect Google Drive/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_MESSAGE));
    expect(called(calls, "GET", `${DRIVE}/auth-url`)).toHaveLength(1);
    expect(window.location.hash).toBe("");
    expect(screen.getByText(NOT_CONNECTED_BANNER)).toBeInTheDocument();
    expect(screen.queryByText("Google Drive connected")).not.toBeInTheDocument();
  });

  it("[V95K-W01] control (D-99): the owner's Disconnect in the Google Drive browser still clears the connection (connect card shown, files gone) with no error", async () => {
    const calls = driveBrowserServer({ connected: true, disconnect: () => jsonResponse(200, { success: true }) });
    render(<GoogleDriveBrowser businessId={BUSINESS} />);

    expect(await screen.findByText(DRIVE_FILE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(await screen.findByRole("heading", { name: "Connect Google Drive" })).toBeInTheDocument();
    expect(called(calls, "DELETE", `${DRIVE}/disconnect`)).toHaveLength(1);
    expect(screen.queryByText(DRIVE_FILE)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("[V95K-W02] control (D-99): the owner's Connect Google Drive goes to the consent URL from the Drive browser, the Google Sheets drawer and the inventory Spreadsheets tab, with no error", async () => {
    driveBrowserServer({ connected: false, authUrl: () => jsonResponse(200, { url: consentUrl("drive-browser-consent") }) });
    const browser = render(<GoogleDriveBrowser businessId={BUSINESS} />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect Google Drive" }));
    await waitFor(() => expect(window.location.hash).toBe("#drive-browser-consent"));
    browser.unmount();
    vi.unstubAllGlobals();

    window.history.replaceState({}, "", "/app/profile");
    sheetServer(() => jsonResponse(200, { url: consentUrl("sheets-drawer-consent") }));
    const drawer = render(<SheetsManageDrawer businessId={BUSINESS} />);
    await screen.findByText(NOT_CONNECTED_BANNER);
    fireEvent.click(screen.getByRole("button", { name: "Connect Google Drive" }));
    await waitFor(() => expect(window.location.hash).toBe("#sheets-drawer-consent"));
    drawer.unmount();
    vi.unstubAllGlobals();

    window.history.replaceState({}, "", "/app/profile");
    sheetServer(() => jsonResponse(200, { url: consentUrl("inventory-consent") }));
    renderInventoryCommandCenter();
    fireEvent.click(screen.getByRole("button", { name: /Spreadsheets/ }));
    await screen.findByText(NOT_CONNECTED_BANNER);
    fireEvent.click(screen.getByRole("button", { name: /Connect Google Drive/ }));
    await waitFor(() => expect(window.location.hash).toBe("#inventory-consent"));

    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe("W9-GOOGLE-WEB-403 (D-99): the Google connector and contact doors W9-GOOGLE-DOORS-SERVER refuses show the server's refusal (green on base, regression pins)", () => {
  const CALENDAR_ACCOUNT = "owner@calendar.example.test";

  function calendarEntry() {
    return {
      meta: {
        type: "google_calendar", name: "Google Calendar", description: "Business calendar", category: "productivity",
        group: "google", icon: "calendar", supportsSync: true, authType: "oauth2", connectMode: "oauth",
      },
      health: {
        status: "connected", lastSyncAt: null, lastErrorAt: null, lastError: null, errorCount: 0, syncCount: 0,
        connectedAt: "2026-11-01T00:00:00.000Z", connectedAccount: CALENDAR_ACCOUNT,
        flows: { keyInbox: false, temporal: true },
      },
    };
  }

  it("[V95K-P01] pin (D-99, green on base): Key Connect Google Calendar card, an ADMIN or STAFF member's Sync now and Disconnect refused with 403 GOOGLE_CONNECT_OWNER_ONLY show the server's refusal, report no success and keep the card connected", async () => {
    window.history.replaceState({}, "", "/app/key-connect");
    const calls = stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${CONNECTORS}/dashboard`)) return jsonResponse(200, [calendarEntry()]);
      if (method === "GET" && pathname.endsWith(`${CONNECTORS}/statuses`)) return jsonResponse(200, []);
      if (method === "POST" && pathname.endsWith(`${CONNECTORS}/sync/google_calendar`)) return ownerOnly(`${CONNECTORS}/sync/google_calendar`);
      if (method === "POST" && pathname.endsWith(`${CONNECTORS}/disconnect/google_calendar`)) return ownerOnly(`${CONNECTORS}/disconnect/google_calendar`);
      return undefined;
    });
    render(<KeyConnectPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Show all integrations/ }));
    const syncNow = await screen.findByRole("button", { name: "Sync now" });
    const card = syncNow.closest("div.rounded-2xl") as HTMLElement;
    expect(within(card).getByText(CALENDAR_ACCOUNT, { exact: false })).toBeInTheDocument();

    fireEvent.click(syncNow);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_MESSAGE));
    expect(called(calls, "POST", `${CONNECTORS}/sync/google_calendar`)).toHaveLength(1);

    fireEvent.click(within(card).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    expect(toast.error).toHaveBeenLastCalledWith(OWNER_ONLY_MESSAGE);
    expect(called(calls, "POST", `${CONNECTORS}/disconnect/google_calendar`)).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(within(card).getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(within(card).getByText(CALENDAR_ACCOUNT, { exact: false })).toBeInTheDocument();
  });

  it("[V95K-P02] pin (D-99, green on base): Integration Health, an ADMIN or STAFF member's Reconnect and Disconnect of Google Calendar refused with 403 GOOGLE_CONNECT_OWNER_ONLY show the server's refusal, go nowhere and keep the row connected", async () => {
    window.history.replaceState({}, "", "/app/key-connect");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls = stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${CONNECTORS}/statuses`)) {
        return jsonResponse(200, [{ type: "google_calendar", name: "Google Calendar", category: "productivity", status: "connected", connectedAccount: CALENDAR_ACCOUNT }]);
      }
      if (method === "GET" && pathname.endsWith(`${CONNECTORS}/activity`)) return jsonResponse(200, []);
      if (method === "GET" && pathname.endsWith(`${CONNECTORS}/needs-attention`)) return jsonResponse(200, { count: 0 });
      if (method === "POST" && pathname.endsWith(`${CONNECTORS}/reconnect/google_calendar`)) return ownerOnly(`${CONNECTORS}/reconnect/google_calendar`);
      if (method === "POST" && pathname.endsWith(`${CONNECTORS}/disconnect/google_calendar`)) return ownerOnly(`${CONNECTORS}/disconnect/google_calendar`);
      return undefined;
    });
    render(<ConnectorHealthSection businessId={BUSINESS} />);

    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_MESSAGE));
    expect(called(calls, "POST", `${CONNECTORS}/reconnect/google_calendar`)).toHaveLength(1);
    expect(window.location.hash).toBe("");

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    expect(toast.error).toHaveBeenLastCalledWith(OWNER_ONLY_MESSAGE);
    expect(called(calls, "POST", `${CONNECTORS}/disconnect/google_calendar`)).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(await screen.findByText(CALENDAR_ACCOUNT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  it("[V95K-P03] pin (D-99, green on base): Google Contacts sync settings, a Sync now refused with 403 GOOGLE_CONNECT_OWNER_ONLY (the door [V94D-T05] gates) shows the server's refusal, no import summary and keeps the account shown as connected", async () => {
    const prefix = `/connect/businesses/${BUSINESS}/contacts`;
    const calls = stubServer((method, pathname) => {
      if (method === "GET" && pathname.endsWith(`${prefix}/status`)) {
        return jsonResponse(200, {
          connected: true, account: "owner@contacts.example.test", lastSyncAt: null, lastImportAt: null,
          lastError: null, lastErrorAt: null, syncCount: 0, totalContacts: 0, googleContacts: 0,
          mappingRules: { defaultTags: [], defaultStatus: null, defaultOwnerId: null, defaultLifecycleStage: null },
          syncProgress: null,
        });
      }
      if (method === "GET" && pathname.endsWith(`${prefix}/recent`)) return jsonResponse(200, []);
      if (method === "GET" && pathname.endsWith(`/identity/businesses/${BUSINESS}/team`)) return jsonResponse(200, []);
      if (method === "POST" && pathname.endsWith(`${prefix}/sync`)) return ownerOnly(`${prefix}/sync`);
      return undefined;
    });
    render(<ContactSyncSettings businessId={BUSINESS} type="google_contacts" />);

    expect(await screen.findByText("Connected as owner@contacts.example.test.")).toBeInTheDocument();
    const syncNow = screen.getByRole("button", { name: "Sync now" });
    await waitFor(() => expect(syncNow).not.toBeDisabled());
    fireEvent.click(syncNow);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(OWNER_ONLY_MESSAGE));
    expect(called(calls, "POST", `${prefix}/sync`)).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByText("Connected as owner@contacts.example.test.")).toBeInTheDocument();
  });
});
