/**
 * SWEEP-P0-SCOPES second review repair (finding SV-2; the rule CRV-1 states: no success toast on a 403
 * for any newly gated route): a social connection the server refuses to disconnect is not shown as
 * disconnected.
 *
 * DELETE /social/businesses/:b/connections/:platform now needs settings admin (it removes the
 * business's credential; membership-only before). Content Studio's Social Connections card awaited
 * disconnectSocial, ignored the answer and said "<platform> disconnected" whatever the server did.
 *
 * Required: a refused disconnect shows the server's refusal and no success; an applied one still
 * says so. The rest of this tab's newly gated connection writes already show the server's error
 * (create, sender identity update, delete, OAuth start); this file pins the one that did not.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ContentStudioTab } from "../content-studio-tab";
import type { ChannelHealthData } from "@/hooks/use-channel-health";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/marketing",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }),
  Toaster: () => null,
}));

const REFUSAL = "Insufficient permissions: settings requires admin access (you have none)";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Forbidden" : "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text),
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

function health(): ChannelHealthData {
  return {
    connections: [],
    destinations: [],
    socialConnections: [{ id: "sc1", platform: "FACEBOOK", accountName: "Owner page", status: "CONNECTED", platformId: "p1", profilePicture: null, scopes: null, expiresAt: null, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" }] as never,
    summary: null,
    oauthAvailability: {},
    loading: false,
    refreshing: false,
    refresh: vi.fn(async () => {}),
    runHealthCheckForConnection: vi.fn(async () => {}),
    getHealthColor: () => "",
    getHealthLabel: (s: string) => s,
  };
}

function stub(sent: string[], write: { status: number; body: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    sent.push(`${method} ${new URL(url, "http://localhost").pathname}`);
    if (method !== "GET") return jsonResponse(write.status, write.body);
    return jsonResponse(200, []);
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

async function disconnect() {
  render(<ContentStudioTab businessId="biz_1" sharedHealth={health()} />);
  fireEvent.click(await screen.findByTitle("Disconnect"));
  const confirm = document.querySelector('svg[class*="lucide-check"]')!.closest("button") as HTMLElement;
  fireEvent.click(confirm);
}

describe("Content Studio: disconnecting a social connection", () => {
  it("[WEB-SOC-01] RED-BEFORE: a refused disconnect shows the server's refusal and never says it disconnected", async () => {
    const sent: string[] = [];
    stub(sent, { status: 403, body: { statusCode: 403, message: REFUSAL, error: "Forbidden" } });
    await disconnect();
    await waitFor(() => expect(sent).toContain("DELETE /social/businesses/biz_1/connections/FACEBOOK"));
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalledWith(REFUSAL));
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });

  it("[WEB-SOC-02] a disconnect the server applies says so", async () => {
    const sent: string[] = [];
    stub(sent, { status: 200, body: { deleted: true, count: 1 } });
    await disconnect();
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalledWith("FACEBOOK disconnected"));
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });
});
