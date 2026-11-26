/**
 * CATALOG-1 web, round 6 (COR-R5-3): Remove all (and Add all) stayed enabled while the run was going on (Remove all
 * until the reload at its end), so a second confirmation started a second run over the same items. While a bulk run
 * is going on both bulk buttons are disabled and a click on them does nothing; they come back when it ends.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { CatalogManager } from "../catalog-manager";
import type { Product } from "@/lib/client";

const product = (n: number) => ({ id: `p_${n}`, name: `Item ${n}`, price: 5, currency: "TTD", category: "PRODUCT", isActive: true }) as unknown as Product;

function held() {
  let release!: () => void;
  const promise = new Promise<void>((res) => { release = res; });
  return { promise, release };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function mount(over: { live: string[]; onSelectAll?: () => void; onDeselectAll?: () => void }) {
  const products = [product(1), product(2), product(3)];
  return render(
    <CatalogManager
      products={products}
      liveProductIds={new Set(over.live)}
      graphProductToServiceMap={new Map(over.live.map((id) => [id, `svc_${id}`]))}
      storeItemCount={over.live.length}
      processingItems={new Set()}
      confirmRemove={null}
      onToggleItem={vi.fn()}
      onSelectAll={over.onSelectAll ?? vi.fn()}
      onDeselectAll={over.onDeselectAll ?? vi.fn()}
      onConfirmRemoveChange={vi.fn()}
      onDeleteFromStore={vi.fn()}
      services={[]}
    />,
  );
}

describe("COR-R5-3: a bulk run in progress", () => {
  it("Remove all is disabled during the run and a click does not start another", async () => {
    const run = held();
    const onDeselectAll = vi.fn(() => run.promise);
    mount({ live: ["p_1", "p_2"], onDeselectAll });
    fireEvent.click(screen.getByRole("button", { name: /^remove all$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm remove all/i }));
    expect(onDeselectAll).toHaveBeenCalledTimes(1);
    const button = screen.getByRole("button", { name: /remove all/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: /remove all/i }));
    expect(onDeselectAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /add all/i }), "Add all during Remove all").toBeDisabled();
    await act(async () => { run.release(); await run.promise; });
    expect(screen.getByRole("button", { name: /^remove all$/i })).not.toBeDisabled();
  });

  it("Add all is disabled during the run and a click does not start another", async () => {
    const run = held();
    const onSelectAll = vi.fn(() => run.promise);
    mount({ live: ["p_1"], onSelectAll });
    fireEvent.click(screen.getByRole("button", { name: /^add all$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm add all/i }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    const button = screen.getByRole("button", { name: /add all/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: /add all/i }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /remove all/i }), "Remove all during Add all").toBeDisabled();
    await act(async () => { run.release(); await run.promise; });
    expect(screen.getByRole("button", { name: /^add all$/i })).not.toBeDisabled();
  });

  it("control: Remove all asks once, then runs", () => {
    const onDeselectAll = vi.fn();
    mount({ live: ["p_1"], onDeselectAll });
    fireEvent.click(screen.getByRole("button", { name: /^remove all$/i }));
    expect(onDeselectAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm remove all/i }));
    expect(onDeselectAll).toHaveBeenCalledTimes(1);
  });
});
