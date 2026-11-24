/**
 * NAV-A2 (sweep BUG-114; journey H): /app/money is a real index.
 *
 * Before: money/page.tsx re-exported finance/page.tsx, which only redirects to /app/financial-flow (and in the sweep's
 * build rendered the error page, BUG-114). Journey H opens Money and takes its entries: Overview, Money in, Expenses
 * & bills, Reports and Books. /app/finance itself forwards to /app/money (middleware), so Books opens the books' own
 * first page, the general ledger, not /app/finance (which would land back here).
 *
 * The page offers only the entries the member's modules open (GET identity/businesses/:b/my-access, read as the nav
 * reads it): unknown hides nothing and the server still refuses. Only `fetch` and the router are stubbed.
 * Cases tagged RED-BEFORE fail on the packet's base (04730333); CONTROL cases pass on both.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }));
const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/app/money",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  redirect,
}));

const BIZ = "biz_nav_a2";

function jsonResponse(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}

/** my-access answers `modules` (null: the read fails); every other read is not this page's and answers 404. */
function serve(modules: Record<string, string> | null) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(url, "http://localhost");
    if (pathname.endsWith(`/identity/businesses/${BIZ}/my-access`)) {
      return modules ? jsonResponse(200, { role: "STAFF", modules }) : jsonResponse(503, { message: "Service Unavailable" });
    }
    return jsonResponse(404, { message: "Not Found" });
  }));
}

async function renderMoney() {
  const { default: Page } = await import("@/app/app/money/page");
  // The base's page calls next/navigation's redirect while rendering; it is recorded, not thrown.
  render(<Page />);
}

const entries = () => {
  const index = screen.getByRole("navigation", { name: /money/i });
  return within(index).getAllByRole("link").map((a) => ({ name: (a.querySelector("[data-entry-name]")?.textContent ?? "").trim(), href: a.getAttribute("href") }));
};

beforeEach(() => {
  router.replace.mockClear();
  redirect.mockClear();
  window.localStorage.setItem("kf_business_id", BIZ);
  window.localStorage.setItem("activeBusinessId", BIZ);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NAV-A2: /app/money is an index (BUG-114, journey H)", () => {
  it("RED-BEFORE: it renders, and sends no one elsewhere", async () => {
    serve(null);
    await renderMoney();
    expect(redirect).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Money" })).toBeTruthy();
  });

  it("RED-BEFORE: it offers Overview, Money in, Expenses & bills, Reports and Books, each opening its page", async () => {
    serve(null);
    await renderMoney();
    expect(entries()).toEqual([
      { name: "Overview", href: "/app/financial-flow" },
      { name: "Money in", href: "/app/payments" },
      { name: "Expenses & bills", href: "/app/expenses" },
      { name: "Reports", href: "/app/reports" },
      { name: "Books", href: "/app/finance/ledger" },
    ]);
  });

  it("RED-BEFORE: each entry is named so journey H finds it (the name first, then a line under it)", async () => {
    serve(null);
    await renderMoney();
    const index = screen.getByRole("navigation", { name: /money/i });
    for (const name of [/^overview\b/i, /^money in\b/i, /^expenses\b/i, /^reports\b/i, /^books\b/i]) {
      expect(within(index).getByRole("link", { name })).toBeTruthy();
    }
  });

  it("RED-BEFORE: a member whose expenses access is none is not offered Expenses & bills; one without analytics is not offered Reports", async () => {
    serve({ revenue: "read", expenses: "none", analytics: "none" });
    await renderMoney();
    await waitFor(() => expect(entries().map((e) => e.name)).not.toContain("Expenses & bills"));
    expect(entries().map((e) => e.name)).toEqual(["Overview", "Money in", "Books"]);
  });

  it("RED-BEFORE: a member with no money access sees why, not an empty page", async () => {
    serve({ revenue: "none", expenses: "none", analytics: "none" });
    await renderMoney();
    expect(await screen.findByText(/no access.*ask the owner/i)).toBeTruthy();
  });
});
