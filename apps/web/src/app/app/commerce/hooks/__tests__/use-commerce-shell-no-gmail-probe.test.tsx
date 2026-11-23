/**
 * MOUNT-QUOTES (D-153 whatsapp; journey D3 "no Gmail needed"): opening Sales
 * does not probe Gmail.
 *
 * The Sales shell loaded products, invoices, contacts, quotes and the business
 * in parallel, and GET gmail/status beside them, on every load. Nothing on the
 * Sales page read that status (the quotes panel takes it as a prop and never
 * reads it; the invoices list and the detail page fetch their own), and journey
 * D3 fails a quote shared by WhatsApp or Copy link on any /gmail/ request the
 * page made: the share needs no email provider, so the page must not ask for one.
 *
 *   UCS-01  RED-BEFORE  the shell's load makes no request under /gmail/
 *   UCS-02  control     the shell still loads products, invoices, contacts, quotes and the business
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

vi.mock("@/lib/workspace", () => ({
  refreshWorkspace: async () => "biz_v1mq_shell",
  getStoredBusinessId: () => "biz_v1mq_shell",
}));
vi.mock("@/lib/image-store", () => ({ getAllProductImages: async () => ({}) }));

import { useCommerceShell } from "../use-commerce-shell";

function installServer() {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input), "http://localhost");
    paths.push(url.pathname);
    const body = url.pathname.endsWith("/contacts")
      ? { contacts: [] }
      : url.pathname.endsWith("/quotes")
        ? { data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }
        : url.pathname.startsWith("/identity/businesses/")
          ? { id: "biz_v1mq_shell", currency: "TTD", metaData: {} }
          : [];
    const text = JSON.stringify(body);
    return { ok: true, status: 200, json: async () => JSON.parse(text) as unknown, text: async () => text } as unknown as Response;
  }));
  return { paths };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MOUNT-QUOTES: the Sales shell does not probe Gmail", () => {
  it("UCS-01 RED-BEFORE: the shell's load makes no request under /gmail/", async () => {
    const server = installServer();
    const { result } = renderHook(() => useCommerceShell());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(server.paths.filter((p) => /\/gmail\//.test(p))).toEqual([]);
  });

  it("UCS-02 control: the shell still loads products, invoices, contacts, quotes and the business", async () => {
    const server = installServer();
    const { result } = renderHook(() => useCommerceShell());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const biz = "/commerce/businesses/biz_v1mq_shell";
    for (const path of [`${biz}/products`, `${biz}/invoices`, `${biz}/quotes`, "/identity/businesses/biz_v1mq_shell"]) {
      expect(server.paths.some((p) => p === path || p.startsWith(`${path}?`)), path).toBe(true);
    }
    expect(server.paths.some((p) => /\/contacts/.test(p))).toBe(true);
    expect(result.current.businessId).toBe("biz_v1mq_shell");
    expect(result.current.businessCurrency).toBe("TTD");
  });
});
