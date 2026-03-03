"use client";

import { useMemo } from "react";
import { Button } from "@keyflow/ui";
import { Plus, Minus } from "lucide-react";
import { Product } from "@/lib/client";
import { InvoiceLineItem, CATEGORIES } from "./commerce-types";

interface LineItemsEditorProps {
  items: InvoiceLineItem[];
  products: Product[];
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateItem: (itemId: string, field: keyof InvoiceLineItem, value: string | boolean) => void;
  onSelectProduct: (itemId: string, productId: string) => void;
  taxRate: string;
  discountType: "PERCENT" | "FIXED";
  discountValue: string;
  onTaxRateChange: (value: string) => void;
  onDiscountTypeChange: (value: "PERCENT" | "FIXED") => void;
  onDiscountValueChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  currency?: string;
}

export default function LineItemsEditor({
  items,
  products,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  onSelectProduct,
  taxRate,
  discountType,
  discountValue,
  onTaxRateChange,
  onDiscountTypeChange,
  onDiscountValueChange,
  notes,
  onNotesChange,
  currency = "TTD",
}: LineItemsEditorProps) {
  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      return sum + qty * price;
    }, 0);

    const tax = taxRate ? subtotal * (parseFloat(taxRate) / 100) : 0;

    let discount = 0;
    if (discountValue) {
      const dv = parseFloat(discountValue);
      if (discountType === "PERCENT") {
        discount = subtotal * (dv / 100);
      } else {
        discount = dv;
      }
    }

    const total = subtotal + tax - discount;
    return { subtotal, tax, discount, total };
  }, [items, taxRate, discountType, discountValue]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Line Items
        </h3>
        <Button size="sm" variant="outline" onClick={onAddItem}>
          <Plus className="w-4 h-4 mr-1" />
          Add Item
        </Button>
      </div>

      <div className="space-y-3">
        {items.map((lineItem, idx) => (
          <div
            key={lineItem.id}
            className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-4 space-y-3"
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_100px] gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Product</label>
                  <select
                    value={lineItem.productId}
                    onChange={(e) => onSelectProduct(lineItem.id, e.target.value)}
                    className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">Select product...</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — ${p.price}
                      </option>
                    ))}
                    <option value="__NEW__">+ New Item</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                  <input
                    type="text"
                    value={lineItem.description}
                    onChange={(e) => onUpdateItem(lineItem.id, "description", e.target.value)}
                    placeholder="Description"
                    className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={lineItem.quantity}
                    onChange={(e) => onUpdateItem(lineItem.id, "quantity", e.target.value)}
                    className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Price</label>
                  <input
                    type="number"
                    step="0.01"
                    value={lineItem.unitPrice}
                    onChange={(e) => onUpdateItem(lineItem.id, "unitPrice", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </div>

              <button
                onClick={() => onRemoveItem(lineItem.id)}
                className="mt-5 p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Remove item"
              >
                <Minus className="w-4 h-4" />
              </button>
            </div>

            {lineItem.productId === "__NEW__" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-border/30">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Item Name</label>
                  <input
                    type="text"
                    value={lineItem.newItemName || ""}
                    onChange={(e) => onUpdateItem(lineItem.id, "newItemName", e.target.value)}
                    placeholder="New item name"
                    className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                  <select
                    value={lineItem.newItemCategory || "SERVICE"}
                    onChange={(e) => onUpdateItem(lineItem.id, "newItemCategory", e.target.value)}
                    className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.value} value={cat.value}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lineItem.addToCatalog || false}
                      onChange={(e) => onUpdateItem(lineItem.id, "addToCatalog", e.target.checked)}
                      className="rounded border-border/60 accent-primary"
                    />
                    <span className="text-muted-foreground">Add to catalog</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Tax Rate (%)</label>
          <input
            type="number"
            step="0.1"
            value={taxRate}
            onChange={(e) => onTaxRateChange(e.target.value)}
            placeholder="0"
            className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Discount</label>
          <div className="flex gap-2">
            <select
              value={discountType}
              onChange={(e) => onDiscountTypeChange(e.target.value as "PERCENT" | "FIXED")}
              className="rounded-lg border border-border/60 bg-background/80 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="PERCENT">%</option>
              <option value="FIXED">$</option>
            </select>
            <input
              type="number"
              step="0.01"
              value={discountValue}
              onChange={(e) => onDiscountValueChange(e.target.value)}
              placeholder="0"
              className="flex-1 rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Additional notes..."
            rows={2}
            className="w-full rounded-lg border border-border/60 bg-background/80 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card/60 backdrop-blur-sm p-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{currency} {totals.subtotal.toFixed(2)}</span>
          </div>
          {totals.tax > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Tax ({taxRate}%)</span>
              <span>{currency} {totals.tax.toFixed(2)}</span>
            </div>
          )}
          {totals.discount > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Discount</span>
              <span>-{currency} {totals.discount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t border-border/40 font-bold text-base">
            <span>Total</span>
            <span className="text-primary">{currency} {totals.total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
