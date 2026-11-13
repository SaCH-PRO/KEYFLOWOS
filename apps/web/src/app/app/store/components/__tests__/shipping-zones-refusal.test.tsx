/**
 * SWEEP-P0-SCOPES round 1 class repair (finding RC-3, minor; the BUG-032 pattern): the store's
 * shipping zones panel shows the server's refusal.
 *
 * Creating, changing and deleting a shipping zone need storefront write since this packet. The
 * panel ignored each answer: a refused delete reloaded the list silently, and a refused save closed
 * the form, so the member lost what they typed and was told nothing.
 *
 * Required: a refused write shows the server's refusal; a refused save keeps the form open with what
 * was typed; a refused delete keeps the zone listed; a write the server applies behaves as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const REFUSAL = "Insufficient permissions: storefront requires write access (you have read)";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), apiDelete: vi.fn() }));
vi.mock("@/lib/api", () => api);

import { ShippingZonesPanel } from "../shipping-zones-panel";

const ZONE = { id: "z1", name: "Caribbean", countries: ["TT"], regions: [], baseFee: 25, perKgRate: 5, freeAbove: null, currency: "TTD", estimatedDays: 3, carrier: null, isActive: true };

beforeEach(() => {
  for (const fn of [api.apiGet, api.apiPost, api.apiPatch, api.apiDelete, toast.success, toast.error]) fn.mockReset();
  api.apiGet.mockResolvedValue({ data: [ZONE], error: null });
});
afterEach(() => cleanup());

describe("shipping zones: a refused write says why", () => {
  it("[WEB-SHP-01] RED-BEFORE: a refused delete shows the server's refusal and the zone stays listed", async () => {
    api.apiDelete.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    render(<ShippingZonesPanel businessId="biz_1" />);
    await screen.findByText("Caribbean");
    fireEvent.click(screen.getByLabelText("Delete zone"));
    await waitFor(() => expect(api.apiDelete).toHaveBeenCalledWith("/marketplace/businesses/biz_1/shipping-zones/z1"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.getByText("Caribbean")).toBeTruthy();
  });

  it("[WEB-SHP-02] RED-BEFORE: a refused create shows the server's refusal and keeps the form open with what was typed", async () => {
    api.apiGet.mockResolvedValue({ data: [], error: null });
    api.apiPost.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    render(<ShippingZonesPanel businessId="biz_1" />);
    fireEvent.click(await screen.findByRole("button", { name: /add zone/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g., Caribbean Region"), { target: { value: "Staff zone" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(api.apiPost).toHaveBeenCalled());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect((screen.getByPlaceholderText("e.g., Caribbean Region") as HTMLInputElement).value).toBe("Staff zone");
  });

  it("[WEB-SHP-03] RED-BEFORE: a refused update shows the server's refusal and keeps the form open", async () => {
    api.apiPatch.mockResolvedValue({ data: null, error: REFUSAL, status: 403 });
    render(<ShippingZonesPanel businessId="biz_1" />);
    await screen.findByText("Caribbean");
    fireEvent.click(screen.getByLabelText("Edit zone"));
    fireEvent.click(screen.getByRole("button", { name: /^update$/i }));
    await waitFor(() => expect(api.apiPatch).toHaveBeenCalled());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(REFUSAL));
    expect(screen.getByRole("button", { name: /^update$/i })).toBeTruthy();
  });

  it("[WEB-SHP-04] a delete and a create the server applies behave as before: no refusal, the list reloads, the form closes", async () => {
    api.apiDelete.mockResolvedValue({ data: { success: true }, error: null });
    api.apiPost.mockResolvedValue({ data: { id: "z2" }, error: null });
    render(<ShippingZonesPanel businessId="biz_1" />);
    await screen.findByText("Caribbean");
    fireEvent.click(screen.getByLabelText("Delete zone"));
    await waitFor(() => expect(api.apiGet).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: /add zone/i }));
    fireEvent.change(screen.getByPlaceholderText("e.g., Caribbean Region"), { target: { value: "Owner zone" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(screen.queryByPlaceholderText("e.g., Caribbean Region")).toBeNull());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
