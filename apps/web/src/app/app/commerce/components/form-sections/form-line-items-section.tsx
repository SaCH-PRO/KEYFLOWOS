"use client";

import { motion } from "framer-motion";
import { FileText, Plus, Minus } from "lucide-react";
import { formatAmount } from "../../utils/commerce-utils";
import { Product } from "@/lib/client";
import { InvoiceLineItem } from "../commerce-types";
import { CATEGORIES } from "../commerce-types";
import { SectionHeader } from "../billing-form-modal";

interface LineItem {
  id: string;
  productId?: string | null;
  description?: string | null;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  total?: number | null;
  isNewItem?: boolean;
  newItemName?: string | null;
  newItemCategory?: string | null;
  addToCatalog?: boolean;
}

interface FormLineItemsSectionProps {
  open: boolean;
  onToggle: () => void;
  accentColor: string;
  items: LineItem[];
  currency: string;
  activeProducts: Product[];
  onAddItem: () => void;
  onRemoveItem: (id: string) => void;
  onUpdateItem: (id: string, field: keyof InvoiceLineItem, value: string | boolean) => void;
  onSelectProduct: (itemId: string, productId: string) => void;
}

export function FormLineItemsSection({
  open,
  onToggle,
  accentColor,
  items,
  currency,
  activeProducts,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  onSelectProduct,
}: FormLineItemsSectionProps) {
  return (
    <>
      <SectionHeader label="Line Items" icon={FileText} open={open} onToggle={onToggle} accentColor={accentColor} />
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-3 pb-3">
          {items.map((lineItem, idx) => (
            <div key={lineItem.id} className="rounded-xl border border-border/40 bg-white/[0.02] p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground/60 font-medium">Item {idx + 1}</span>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onRemoveItem(lineItem.id)}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_90px] gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Product</label>
                  <select
                    value={lineItem.productId ?? ""}
                    onChange={(e) => onSelectProduct(lineItem.id, e.target.value)}
                    className="kf-input w-full text-sm"
                  >
                    <option value="">Select product...</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatAmount(p.price, currency)}
                      </option>
                    ))}
                    <option value="__NEW__">+ New Item</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Description</label>
                  <input
                    type="text"
                    value={lineItem.description ?? ""}
                    onChange={(e) => onUpdateItem(lineItem.id, "description", e.target.value)}
                    placeholder="Item description"
                    className="kf-input w-full text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Qty</label>
                  <input
                    type="number"
                    min="1"
                    value={lineItem.quantity ?? ""}
                    onChange={(e) => onUpdateItem(lineItem.id, "quantity", e.target.value)}
                    className="kf-input w-full text-sm text-center"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">Unit Price</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={lineItem.unitPrice ?? ""}
                    onChange={(e) => onUpdateItem(lineItem.id, "unitPrice", e.target.value)}
                    placeholder="0.00"
                    className="kf-input w-full text-sm"
                  />
                </div>
              </div>

              {lineItem.isNewItem && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-border/20">
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Item Name</label>
                    <input
                      type="text"
                      value={lineItem.newItemName ?? ""}
                      onChange={(e) => onUpdateItem(lineItem.id, "newItemName", e.target.value)}
                      placeholder="New item name"
                      className="kf-input w-full text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-muted-foreground">Category</label>
                    <select
                      value={lineItem.newItemCategory ?? "SERVICE"}
                      onChange={(e) => onUpdateItem(lineItem.id, "newItemCategory", e.target.value)}
                      className="kf-input w-full text-sm"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end pb-0.5">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={lineItem.addToCatalog ?? false}
                        onChange={(e) => onUpdateItem(lineItem.id, "addToCatalog", e.target.checked)}
                        className="rounded border-border"
                      />
                      Add to catalog
                    </label>
                  </div>
                </div>
              )}

              {lineItem.unitPrice && lineItem.quantity && (
                <div className="text-right">
                  <span className="text-xs text-muted-foreground">
                    Subtotal:{" "}
                    <span className="text-foreground font-medium">
                      {formatAmount(
                        (parseFloat(String(lineItem.quantity)) || 0) * (parseFloat(String(lineItem.unitPrice)) || 0),
                        currency,
                      )}
                    </span>
                  </span>
                </div>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={onAddItem}
            className="w-full min-h-[44px] rounded-xl border border-dashed border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border hover:bg-white/[0.03] transition-all flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Line Item
          </button>
        </motion.div>
      )}
    </>
  );
}
