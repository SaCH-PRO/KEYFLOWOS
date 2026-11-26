/**
 * CUSTOMER-PAGE-HONESTY (journey F1 "the owner shares the slug, not the id"): every link the owner is offered to
 * share is /book/<saved slug>.
 *
 * WHY this test exists: a business is created with no slug (Business.slug is nullable, and the business create sets
 * none), and Your page built its share link as `storeSlug || businessId`, where storeSlug is the slug input's
 * unsaved text. So a business that had not saved a store address shared /book/<cuid> from the store header, the
 * performance tab, the SEO preview and Store settings, and an owner typing a new address was offered (copy, QR,
 * WhatsApp, open) a link that did not exist yet. The commerce header's service-link widget did the same
 * (`slug || businessId`). Now the link is built only from the saved slug; with none there is no link, and Store
 * settings says to save the address first.
 *
 * The hook harness is use-store-data-r8.test.tsx's (lib/client, lib/api and the workspace stubbed at the edge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderHook, render, screen, waitFor, cleanup, act } from "@testing-library/react";

const A = "cmbizslugless0000000000a";
const B = "cmbizslugged00000000000b";

type Res<T> = { data: T | null; error: string | null };
const ok = <T,>(data: T): Res<T> => ({ data, error: null });
const failed = <T,>(): Res<T> => ({ data: null, error: "Internal server error" });

const ws = vi.hoisted(() => ({ businessId: "cmbizslugless0000000000a" }));
const client = vi.hoisted(() => ({
  getBusinessById: vi.fn().mockName("getBusinessById"),
  updateBusiness: vi.fn().mockName("updateBusiness"),
  fetchStorefrontConfig: vi.fn().mockName("fetchStorefrontConfig"),
  updateStorefrontConfig: vi.fn().mockName("updateStorefrontConfig"),
  fetchServices: vi.fn().mockName("fetchServices"),
  fetchStaff: vi.fn().mockName("fetchStaff"),
  fetchAllProducts: vi.fn().mockName("fetchAllProducts"),
  fetchStoreGraph: vi.fn().mockName("fetchStoreGraph"),
  fetchStoreReadiness: vi.fn().mockName("fetchStoreReadiness"),
  fetchStoreAnalytics: vi.fn().mockName("fetchStoreAnalytics"),
  backfillStoreLinks: vi.fn().mockName("backfillStoreLinks"),
  createService: vi.fn().mockName("createService"),
  deleteService: vi.fn().mockName("deleteService"),
  updateService: vi.fn().mockName("updateService"),
}));
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
const emit = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock("@/lib/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/client")>();
  return { ...actual, ...client };
});
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiGet: api.apiGet };
});
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return { ...actual, refreshWorkspace: vi.fn(() => Promise.resolve(ws.businessId)), getStoredBusinessId: vi.fn(() => ws.businessId) };
});
vi.mock("@/hooks/use-app-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-app-layout")>();
  return { ...actual, useMemberModuleLevels: () => null };
});
vi.mock("@/hooks/use-module-events", () => ({ useModuleEmit: () => emit }));
vi.mock("sonner", () => ({ toast }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async (url: string) => `data:image/png;qr,${encodeURIComponent(url)}`) } }));

import { useStoreData } from "../hooks/use-store-data";
import { StoreSettings } from "../components/store-settings";
import { ServiceLinkWidget } from "../../commerce/components/service-link-widget";

let bizOf: Record<string, { id: string; name: string; slug: string | null; businessHours: null }>;

beforeEach(() => {
  ws.businessId = A;
  window.localStorage.clear();
  bizOf = {
    [A]: { id: A, name: "Shop A", slug: null, businessHours: null },
    [B]: { id: B, name: "Shop B", slug: "shop-b", businessHours: null },
  };
  client.getBusinessById.mockImplementation(async (biz: string) => ok(bizOf[biz]));
  client.fetchStorefrontConfig.mockImplementation(async () => ok({ hero: {}, appearance: {}, merchandising: {}, promotions: {}, socialProof: {}, seo: {} }));
  client.fetchServices.mockImplementation(async () => ok([]));
  client.fetchStaff.mockImplementation(async () => ok([]));
  client.fetchAllProducts.mockImplementation(async () => ok([]));
  client.fetchStoreGraph.mockImplementation(async () => ok({ mappings: [], liveCount: 0, draftCount: 0, driftCount: 0, totalProducts: 0 }));
  client.fetchStoreReadiness.mockImplementation(async () => failed());
  client.fetchStoreAnalytics.mockImplementation(async () => failed());
  client.backfillStoreLinks.mockImplementation(async () => {});
  client.updateBusiness.mockImplementation(async (input: { businessId: string; slug?: string }) => ok({ ...bizOf[input.businessId], ...input }));
  api.apiGet.mockImplementation(async (path: string) => {
    const m = /^\/identity\/businesses\/([^/]+)$/.exec(path);
    if (m && bizOf[m[1]]) return ok({ ...bizOf[m[1]], storeEnabled: true });
    if (path.startsWith("/identity/businesses/slug-check/")) return ok({ available: true });
    return { data: null, error: null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function loadStore(biz: string) {
  ws.businessId = biz;
  const hook = renderHook(() => useStoreData());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await waitFor(() => expect(hook.result.current.businessId).toBe(biz));
  await waitFor(() => expect(hook.result.current.businessData).not.toBeNull());
  return hook;
}

describe("Your page: the share link is /book/<saved slug>, never the business id or unsaved text", () => {
  it("a business with no saved slug has no share link at all (not /book/<cuid>)", async () => {
    const hook = await loadStore(A);
    const url = hook.result.current.getPublicBookingUrl();
    expect(url, "the business id in the share link").not.toContain(A);
    expect(url).toBe("");
  });

  it("an address typed but not saved is not offered as the link", async () => {
    const slugless = await loadStore(A);
    act(() => slugless.result.current.setStoreSlug("new-name"));
    expect(slugless.result.current.getPublicBookingUrl(), "the unsaved text in the share link").toBe("");
    slugless.unmount();

    const slugged = await loadStore(B);
    expect(slugged.result.current.getPublicBookingUrl()).toBe(`${window.location.origin}/book/shop-b`);
    act(() => slugged.result.current.setStoreSlug("other-name"));
    expect(slugged.result.current.getPublicBookingUrl(), "the saved address until the new one is saved").toBe(`${window.location.origin}/book/shop-b`);
  });

  it("once saved, the new address is the link", async () => {
    const hook = await loadStore(A);
    act(() => hook.result.current.setStoreSlug("pepper-co"));
    await act(async () => { await hook.result.current.handleSaveSlug(); });
    await waitFor(() => expect(hook.result.current.getPublicBookingUrl()).toBe(`${window.location.origin}/book/pepper-co`));
  });
});

describe("Store settings: no link to copy, scan or open until the address is saved", () => {
  const renderSettings = (slug: string, currentSlug: string | null, publicUrl: string) =>
    render(
      <StoreSettings businessId={A} slug={slug} currentSlug={currentSlug} publicUrl={publicUrl}
        onSlugChange={() => {}} onSaveSlug={async () => {}} slugSaving={false} />,
    );

  it("with no saved slug: nothing to copy or open, and a hint to save the address", async () => {
    renderSettings("new-name", null, "");
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h.includes("/book/")), "a link to an address that is not saved").toEqual([]);
    expect(screen.queryByTitle("Copy"), "a copy button for an unsaved address").toBeNull();
    expect(screen.getByText(/save your store link/i)).toBeTruthy();
  });

  it("with a saved slug and new text typed: what is offered is the saved address", async () => {
    const saved = `${window.location.origin}/book/shop-b`;
    renderSettings("other-name", "shop-b", saved);
    const hrefs = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h.includes("/book/other-name")), "a link to the unsaved address").toEqual([]);
    await waitFor(() => expect(screen.getByAltText("Store QR Code").getAttribute("src")).toContain(encodeURIComponent(saved)));
  });
});

describe("commerce header: the service link is /book/<saved slug> or nothing", () => {
  it("a business with no saved slug is asked to set the link up, and no /book/<cuid> is shown", async () => {
    ws.businessId = A;
    render(<ServiceLinkWidget compact />);
    await screen.findByText(/set up service link/i);
    expect(document.body.innerHTML, "the business id in a link").not.toContain(`/book/${A}`);
  });

  it("a business with a saved slug shows /book/<slug>", async () => {
    ws.businessId = B;
    render(<ServiceLinkWidget compact />);
    await screen.findByText(new RegExp(`/book/shop-b$`));
  });
});
