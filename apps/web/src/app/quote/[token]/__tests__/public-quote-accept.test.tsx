/**
 * V1-QUOTE-CHAIN-finish (review SEC-5): the customer accepts the terms they saw.
 *
 * At the packet base the public quote page POSTed accept with an empty body,
 * so an operator edit made while the customer had the page open was accepted
 * as if the customer had seen it, and convert {} invoiced it. The server now
 * serves `termsVersion` with the signed-token view and requires it on accept
 * (409 quote_terms_changed when the stored terms moved on).
 *
 * Contract pinned here (fetch stubbed at the network edge, the real client):
 *   - Accept sends the termsVersion the page loaded;
 *   - on 409 quote_terms_changed the page reloads the quote, shows the updated
 *     terms with a notice, and does not mark the quote accepted;
 *   - a second Accept sends the new version and the page shows the acceptance.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useParams: () => ({ token: "tok_v53b" }) }));
vi.mock("@/app/_lib/PresenceTracker", () => ({ PresenceTracker: () => null }));
vi.mock("@/app/_lib/presence-sdk", () => ({ pickBusinessId: () => null }));

import PublicQuotePage from "../page";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? "Error" : "OK",
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
  } as unknown as Response;
}

function publicQuote(fields: Record<string, unknown>) {
  return {
    id: "q_v53b",
    quoteNumber: "QT-V53B",
    status: "SENT",
    total: 100,
    currency: "TTD",
    issueDate: "2026-11-01T10:00:00.000Z",
    businessId: "biz_v53b",
    contactId: "ct_v53b",
    items: [{ id: "i1", description: "Original line", quantity: 1, unitPrice: 100, total: 100 }],
    createdAt: "2026-11-01T10:00:00.000Z",
    lifecycleStep: "VIEWED",
    termsVersion: "tv_original",
    ...fields,
  };
}

type Call = { method: string; path: string; body: Record<string, unknown> | null };

function installServer(script: { views: unknown[]; accepts: Array<[number, unknown]> }) {
  const calls: Call[] = [];
  let view = 0;
  let accept = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      calls.push({ method, path: url.pathname, body });
      if (method === "GET" && url.pathname.endsWith("/commerce/public/quotes/tok_v53b")) {
        const next = script.views[Math.min(view, script.views.length - 1)];
        view += 1;
        return jsonResponse(200, next);
      }
      if (method === "POST" && url.pathname.endsWith("/commerce/public/quotes/tok_v53b/accept")) {
        const [status, next] = script.accepts[Math.min(accept, script.accepts.length - 1)];
        accept += 1;
        return jsonResponse(status, next);
      }
      return jsonResponse(404, { message: "not stubbed" });
    }),
  );
  return { accepts: () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/accept")), views: () => calls.filter((c) => c.method === "GET") };
}

describe("public quote page: accept carries the terms the customer saw (SEC-5)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Accept sends the loaded termsVersion; a 409 quote_terms_changed reloads the updated terms with a notice instead of accepting; the next Accept sends the new version", async () => {
    const edited = publicQuote({ total: 900, termsVersion: "tv_edited", items: [{ id: "i2", description: "Edited line", quantity: 9, unitPrice: 100, total: 900 }] });
    const server = installServer({
      views: [publicQuote({}), edited],
      accepts: [
        [409, { statusCode: 409, code: "quote_terms_changed", message: "This quote was updated after you opened it." }],
        [201, { ...edited, status: "ACCEPTED", acceptedAt: "2026-11-02T10:00:00.000Z", lifecycleStep: "ACCEPTED" }],
      ],
    });

    render(<PublicQuotePage />);
    expect(await screen.findByText("Original line")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /accept quote/i }));
    await waitFor(() => expect(server.accepts()).toHaveLength(1));
    expect(server.accepts()[0].body).toMatchObject({ termsVersion: "tv_original" });

    expect(await screen.findByText("Edited line")).toBeTruthy();
    expect(screen.getByText(/updated after you opened it|terms have changed|was updated/i)).toBeTruthy();
    expect(screen.queryByText(/you accepted this quote/i)).toBeNull();
    expect(server.views().length).toBeGreaterThanOrEqual(2);

    fireEvent.click(screen.getByRole("button", { name: /accept quote/i }));
    await waitFor(() => expect(server.accepts()).toHaveLength(2));
    expect(server.accepts()[1].body).toMatchObject({ termsVersion: "tv_edited" });
    expect(await screen.findByText(/you accepted this quote/i)).toBeTruthy();
  });
});
