/**
 * FU-FINANCE-INTEL-DOORS (owner ruling D-258): the finance intelligence doors now refuse below their scope. Resolve and
 * dismiss need revenue write; the scan needs revenue read. A revenue-read member (every STAFF on role defaults) still
 * sees the "Needs attention" panel (its list needs revenue read only) and its Resolve, Dismiss and Scan buttons; the web
 * cannot read a member's own scope map on main, so the buttons stay and the server's answer decides. Before this, the
 * panel dropped every answer: a refused Resolve or Dismiss left the item with nothing said, and Scan ignored its result.
 * Now every refusal or error is said (ModuleScopeGuard's revenue refusal as the access it needs, any other error in the
 * server's words), the item the server kept stays, and nothing claims success.
 *
 *   IP-01  RED-BEFORE  a refused Resolve says the refusal (revenue write) and the item stays
 *   IP-02  RED-BEFORE  a refused Dismiss says the refusal (revenue write) and the item stays
 *   IP-03  RED-BEFORE  a refused Scan says the refusal (revenue read); a failed Scan says the server's error
 *   IP-04  control     an allowed Resolve and Dismiss remove the item and say no error
 *
 * Mounted on the real panel and the real api client (lib/api.ts, lib/client.ts); only `fetch` is stubbed.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { FinanceIntelPanel } from "../_intel-panel";

const FIN = "/finance/businesses/biz_1";
const WRITE_REFUSAL = "Insufficient permissions: revenue requires write access (you have read)";
const READ_REFUSAL = "Insufficient permissions: revenue requires read access (you have none)";

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

/** The production filter's body for an error answer (http-exception.filter.ts). */
function failed(status: number, message: string, path: string) {
  return jsonResponse(status, { statusCode: status, code: status === 403 ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR", message, error: status === 403 ? "Forbidden" : "Internal Server Error", timestamp: "2026-11-22T00:00:00.000Z", path }, status === 403 ? "Forbidden" : "Internal Server Error");
}

const ITEM = {
  id: "fai_1", businessId: "biz_1", kind: "OVERSPENDING", severity: "WARNING", title: "Marketing is over budget", body: "Spent 120% of the month's budget.",
  entityType: "budget", entityId: "b_1", recommendedAction: null, amount: null, evidence: null, status: "OPEN",
  detectedAt: "2026-11-01T00:00:00.000Z", resolvedAt: null,
};

function stubServer(route: (method: string, pathname: string) => Response | undefined) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    return route(method, pathname) ?? jsonResponse(200, {});
  }));
}

function panelServer(opts: { write?: (pathname: string) => Response; scan?: () => Response } = {}) {
  stubServer((method, pathname) => {
    if (method === "GET" && pathname.endsWith(`${FIN}/intelligence/actions`)) return jsonResponse(200, { items: [ITEM] });
    if (method === "POST" && pathname.endsWith(`${FIN}/intelligence/scan`)) return opts.scan ? opts.scan() : jsonResponse(201, { created: 0, refreshed: 1, superseded: 0 });
    if (method === "POST" && pathname.includes(`${FIN}/intelligence/actions/`)) return opts.write ? opts.write(pathname) : jsonResponse(201, { ...ITEM, status: "RESOLVED" });
    return undefined;
  });
}

const alertText = () => screen.queryAllByRole("alert").map((n) => n.textContent ?? "").join("\n");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("FinanceIntelPanel says every refusal (FU-FINANCE-INTEL-DOORS, D-258)", () => {
  it.each([
    ["IP-01", "Mark resolved", "resolve"],
    ["IP-02", "Dismiss", "dismiss"],
  ])("%s RED-BEFORE: a refused %s says the refusal (revenue write) and the item stays", async (_id, label, door) => {
    panelServer({ write: (pathname) => failed(403, WRITE_REFUSAL, pathname) });
    render(<FinanceIntelPanel businessId="biz_1" currency="TTD" />);
    expect(await screen.findByText(ITEM.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(alertText()).toContain(WRITE_REFUSAL));
    expect(alertText(), door).toMatch(/revenue write access/);
    expect(screen.getByText(ITEM.title)).toBeInTheDocument();
  });

  it("IP-03 RED-BEFORE: a refused Scan says the refusal (revenue read); a failed Scan says the server's error", async () => {
    panelServer({ scan: () => failed(403, READ_REFUSAL, `${FIN}/intelligence/scan`) });
    render(<FinanceIntelPanel businessId="biz_1" currency="TTD" />);
    expect(await screen.findByText(ITEM.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run finance scan" }));
    await waitFor(() => expect(alertText()).toContain(READ_REFUSAL));
    expect(alertText()).toMatch(/revenue read access/);
    cleanup();
    vi.unstubAllGlobals();

    panelServer({ scan: () => failed(500, "Internal server error", `${FIN}/intelligence/scan`) });
    render(<FinanceIntelPanel businessId="biz_1" currency="TTD" />);
    expect(await screen.findByText(ITEM.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run finance scan" }));
    await waitFor(() => expect(alertText()).toContain("Internal server error"));
  });

  it.each([
    ["Mark resolved"],
    ["Dismiss"],
  ])("IP-04 control: an allowed %s removes the item and says no error", async (label) => {
    panelServer();
    render(<FinanceIntelPanel businessId="biz_1" currency="TTD" />);
    expect(await screen.findByText(ITEM.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(screen.queryByText(ITEM.title)).not.toBeInTheDocument());
    expect(alertText()).toBe("");
  });
});
