/**
 * W6-WEB-STATUS-OPTIONS (owner ruling D-92, review finding CR-D92R-1): the
 * Key Connect contact sync settings (Google Contacts and Outlook Contacts)
 * offer only the four contact statuses as the default status.
 *
 * D-92: every stored Contact.status is one of LEAD, PROSPECT, CLIENT, LOST.
 * W5-D92-RESIDUALS made PUT connect/businesses/:b/{contacts,outlook-contacts}/
 * mapping-rules answer 400 for any other defaultStatus, but the web select
 * (STATUS_OPTIONS in contact-sync-settings.tsx) still offered ACTIVE, INACTIVE
 * and ARCHIVED, and no CLIENT or LOST: choosing one of those three got a 400,
 * and a business could never pick CLIENT or LOST.
 *
 * RED-BEFORE on 45b060b5: the select offered LEAD, PROSPECT, ACTIVE, INACTIVE,
 * ARCHIVED.
 *
 * Mounted on the real component and the real api client (lib/api.ts); only
 * `fetch` and the toast are stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), message: vi.fn(),
    warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: toastMock.toast, Toaster: () => null }));
const { toast } = toastMock;

import { ContactSyncSettings } from "../contact-sync-settings";

const BUSINESS = "biz_1";
const MEMBER_ID = "user_member_1";
/** D-92: the only statuses a contact can hold. */
const FOUR_STATUSES = ["LEAD", "PROSPECT", "CLIENT", "LOST"];

type SyncType = "google_contacts" | "outlook_contacts";
const prefixOf = (type: SyncType) => (type === "google_contacts" ? "contacts" : "outlook-contacts");

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

function connectedStatus() {
  return {
    connected: true,
    account: "owner@example.test",
    lastSyncAt: null,
    lastImportAt: null,
    lastError: null,
    lastErrorAt: null,
    syncCount: 0,
    totalContacts: 0,
    googleContacts: 0,
    mappingRules: { defaultTags: [], defaultStatus: null, defaultOwnerId: null, defaultLifecycleStage: null },
    syncProgress: null,
  };
}

interface Call { method: string; pathname: string; body: unknown }

function stubServer(
  type: SyncType,
  onPut: (body: unknown) => Response = () => jsonResponse(200, { ok: true }),
) {
  const prefix = `/connect/businesses/${BUSINESS}/${prefixOf(type)}`;
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, pathname, body });
    if (method === "GET" && pathname === `${prefix}/status`) return jsonResponse(200, connectedStatus());
    if (method === "GET" && pathname === `${prefix}/recent`) return jsonResponse(200, []);
    if (method === "GET" && pathname === `/identity/businesses/${BUSINESS}/team`) {
      return jsonResponse(200, [{ userId: MEMBER_ID, name: "Member One", email: "member@example.test", role: "STAFF" }]);
    }
    if (method === "PUT" && pathname === `${prefix}/mapping-rules`) return onPut(body);
    return jsonResponse(404, { message: "Not stubbed" }, "Not Found");
  }));
  return { calls, rulesPath: `${prefix}/mapping-rules` };
}

/** The select under a "Default ..." label in the mapping rules section. */
async function selectLabelled(label: string): Promise<HTMLSelectElement> {
  const labelEl = await screen.findByText(label);
  const select = labelEl.parentElement?.querySelector("select");
  if (!select) throw new Error(`no select under "${label}"`);
  return select;
}

const optionValues = (select: HTMLSelectElement) =>
  Array.from(select.options).map((o) => o.value).filter((v) => v !== "");

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each<SyncType>(["google_contacts", "outlook_contacts"])("W6-WEB-STATUS-OPTIONS D-92 CR-D92R-1: %s sync settings, default status", (type) => {
  it("RED-BEFORE: the default status select offers exactly LEAD, PROSPECT, CLIENT, LOST (no ACTIVE, INACTIVE or ARCHIVED), besides no change", async () => {
    stubServer(type);
    render(<ContactSyncSettings businessId={BUSINESS} type={type} />);

    const select = await selectLabelled("Default status");
    expect(optionValues(select)).toEqual(FOUR_STATUSES);
    expect(select.options[0]?.value).toBe("");
    const keys = Array.from(select.options).map((o) => o.value);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("a chosen status (CLIENT) is what the save sends as defaultStatus", async () => {
    const { calls, rulesPath } = stubServer(type);
    render(<ContactSyncSettings businessId={BUSINESS} type={type} />);

    fireEvent.change(await selectLabelled("Default status"), { target: { value: "CLIENT" } });
    fireEvent.click(screen.getByRole("button", { name: /Save rules/ }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Mapping rules saved"));
    const puts = calls.filter((c) => c.method === "PUT" && c.pathname === rulesPath);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toMatchObject({ defaultStatus: "CLIENT" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a 400 the server answers the save with is shown with the server's own message, and nothing is reported saved", async () => {
    const message = "defaultOwnerId must belong to a member of this business";
    const { calls, rulesPath } = stubServer(type, () =>
      jsonResponse(400, {
        statusCode: 400, message, error: "Bad Request",
        timestamp: "2026-11-09T00:00:00.000Z", path: `/connect/businesses/${BUSINESS}/${prefixOf(type)}/mapping-rules`,
      }, "Bad Request"));
    render(<ContactSyncSettings businessId={BUSINESS} type={type} />);

    fireEvent.change(await selectLabelled("Default status"), { target: { value: "LOST" } });
    fireEvent.change(await selectLabelled("Default owner"), { target: { value: MEMBER_ID } });
    fireEvent.click(screen.getByRole("button", { name: /Save rules/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(toast.success).not.toHaveBeenCalled();
    const puts = calls.filter((c) => c.method === "PUT" && c.pathname === rulesPath);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toMatchObject({ defaultStatus: "LOST", defaultOwnerId: MEMBER_ID });
  });
});
