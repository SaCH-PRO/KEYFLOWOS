/**
 * CATALOG-1 web, review round 1 re-proof (live sweep-product-create at 51be3cfa, 768x1024, 1 of 8 runs): the
 * product form moves focus to Name 100 ms after it opens. An owner (or a browser) already typing in Price when that
 * timer fires had the rest of the typing land in Name: the product was renamed "Pepper sauce my6ci50" and its price
 * kept. The form focuses Name only when focus is not already inside the form.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ProductFormModal } from "../product-form-modal";
import type { ProductForm } from "../../components/commerce-types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Harness() {
  const [form, setForm] = useState<ProductForm>({
    name: "Pepper sauce", description: "", price: "45", category: "PRODUCT", duration: "", imageUrl: "", sku: "", isActive: true,
  });
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <ProductFormModal
      open
      editingProductId="p_1"
      productForm={form}
      setProductForm={setForm}
      formError={null}
      imagePreview={preview}
      setImagePreview={setPreview}
      onClose={() => {}}
      onSave={() => {}}
      onRemoveImage={() => {}}
      currency="USD"
    />
  );
}

describe("the product form does not take focus from a field the user is already in", () => {
  it("focus moved to Price before the open timer fires stays in Price", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const price = screen.getByLabelText(/^price/i);
    price.focus();
    act(() => { vi.advanceTimersByTime(250); });
    expect(document.activeElement).toBe(price);
  });

  it("control: with focus nowhere in the form, Name is focused when it opens", () => {
    vi.useFakeTimers();
    render(<Harness />);
    act(() => { vi.advanceTimersByTime(250); });
    expect(document.activeElement).toBe(screen.getByLabelText(/^name/i));
  });
});
