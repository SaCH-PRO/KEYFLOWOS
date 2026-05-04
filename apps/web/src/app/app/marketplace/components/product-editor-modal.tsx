"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Package,
  Layers,
  Link2,
  DollarSign,
  Tag,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import { inputClass, selectClass, FormField } from "./marketplace-utils";

type ProductEditorTab = "general" | "variants" | "sources" | "cost" | "listing";

interface VariantInput {
  name?: string;
  sku?: string;
  price?: string;
  stock?: string;
  [key: string]: unknown;
}

const EDITOR_TABS: { key: ProductEditorTab; label: string; icon: React.ElementType }[] = [
  { key: "general", label: "General", icon: Package },
  { key: "variants", label: "Variants", icon: Layers },
  { key: "sources", label: "Sources", icon: Link2 },
  { key: "cost", label: "Cost Profile", icon: DollarSign },
  { key: "listing", label: "Listing Preview", icon: Tag },
];

export function ProductEditorModal({
  open,
  onClose,
  product,
  onChange,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  product: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ProductEditorTab>("general");
  const [variants, setVariants] = useState<VariantInput[]>([]);

  useEffect(() => {
    if (open) {
       
      setActiveTab("general");
      setVariants((product.variants as VariantInput[] | undefined) ?? []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-runs only when the modal opens or the selected product identity changes, to seed the editor. Including `product.variants` would clobber in-progress edits whenever the parent updates the variants array.
  }, [open, product.id]);

  if (!open) return null;

  const updateField = (key: string, value: unknown) => onChange(key, value);

  const addVariant = () => {
    const updated: VariantInput[] = [...variants, { name: "", sku: "", price: "", stock: "" }];
    setVariants(updated);
    onChange("variants", updated);
  };

  const updateVariant = (idx: number, key: string, value: string) => {
    const updated = variants.map((v, i) => (i === idx ? { ...v, [key]: value } : v));
    setVariants(updated);
    onChange("variants", updated);
  };

  const removeVariant = (idx: number) => {
    const updated = variants.filter((_, i) => i !== idx);
    setVariants(updated);
    onChange("variants", updated);
  };

  const costPrice = parseFloat(String(product.costPrice ?? 0));
  const sellPrice = parseFloat(String(product.price ?? 0));
  const shippingCost = parseFloat(String(product.shippingCost ?? 0));
  const dutyRate = parseFloat(String(product.dutyRate ?? 0));
  const landedCost = costPrice + shippingCost + (costPrice * dutyRate) / 100;
  const margin = sellPrice > 0 ? ((sellPrice - landedCost) / sellPrice) * 100 : 0;
  const marginColor = margin >= 30 ? "text-emerald-400" : margin >= 15 ? "text-amber-400" : "text-red-400";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative bg-[#0a0a0f]/97 border border-white/10 rounded-2xl backdrop-blur-xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-orange-400" />
              <h2 className="text-sm font-semibold">{product.id ? "Edit Product" : "New Product"}</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1 px-4 py-2.5 border-b border-white/5 overflow-x-auto scrollbar-hide shrink-0">
            {EDITOR_TABS.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? "bg-orange-500/15 text-orange-400"
                      : "text-muted-foreground hover:text-white hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {activeTab === "general" && (
              <>
                <FormField label="Product Name">
                  <input
                    value={String(product.name ?? "")}
                    onChange={(e) => updateField("name", e.target.value)}
                    className={inputClass}
                    placeholder="Product name"
                  />
                </FormField>
                <FormField label="SKU">
                  <input
                    value={String(product.sku ?? "")}
                    onChange={(e) => updateField("sku", e.target.value)}
                    className={inputClass}
                    placeholder="SKU-001"
                  />
                </FormField>
                <FormField label="Description">
                  <textarea
                    value={String(product.description ?? "")}
                    onChange={(e) => updateField("description", e.target.value)}
                    className={inputClass}
                    rows={3}
                    placeholder="Product description..."
                  />
                </FormField>
                <FormField label="Fulfillment Model">
                  <select
                    value={String(product.fulfillmentModel ?? "")}
                    onChange={(e) => updateField("fulfillmentModel", e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select model...</option>
                    <option value="local_stock">Local Stock</option>
                    <option value="dropship">Dropship</option>
                    <option value="preorder">Pre-Order</option>
                    <option value="manual">Manual</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Category">
                    <input
                      value={String(product.category ?? "")}
                      onChange={(e) => updateField("category", e.target.value)}
                      className={inputClass}
                      placeholder="Electronics"
                    />
                  </FormField>
                  <FormField label="HS Code">
                    <input
                      value={String(product.hsCode ?? "")}
                      onChange={(e) => updateField("hsCode", e.target.value)}
                      className={inputClass}
                      placeholder="8471.30"
                    />
                  </FormField>
                </div>
              </>
            )}

            {activeTab === "variants" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Manage product variants (size, color, etc.)</p>
                  <button
                    onClick={addVariant}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add Variant
                  </button>
                </div>
                {variants.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No variants yet. Add variants for different sizes, colors, or options.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {variants.map((variant, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-4 gap-2 items-end p-3 bg-white/3 rounded-xl border border-white/8"
                        style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}
                      >
                        <FormField label="Name">
                          <input
                            value={variant.name || ""}
                            onChange={(e) => updateVariant(idx, "name", e.target.value)}
                            className={inputClass}
                            placeholder="Small"
                          />
                        </FormField>
                        <FormField label="SKU">
                          <input
                            value={variant.sku || ""}
                            onChange={(e) => updateVariant(idx, "sku", e.target.value)}
                            className={inputClass}
                            placeholder="SKU-S"
                          />
                        </FormField>
                        <FormField label="Price">
                          <input
                            type="number"
                            value={variant.price || ""}
                            onChange={(e) => updateVariant(idx, "price", e.target.value)}
                            className={inputClass}
                            placeholder="25.00"
                          />
                        </FormField>
                        <button
                          onClick={() => removeVariant(idx)}
                          className="p-2 rounded-lg hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors mb-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "sources" && (
              <>
                <FormField label="Supplier Name">
                  <input
                    value={String(product.supplierName ?? "")}
                    onChange={(e) => updateField("supplierName", e.target.value)}
                    className={inputClass}
                    placeholder="Supplier Co."
                  />
                </FormField>
                <FormField label="Supplier Email">
                  <input
                    value={String(product.supplierEmail ?? "")}
                    onChange={(e) => updateField("supplierEmail", e.target.value)}
                    className={inputClass}
                    placeholder="supplier@example.com"
                  />
                </FormField>
                <FormField label="Source URL">
                  <input
                    value={String(product.sourceUrl ?? "")}
                    onChange={(e) => updateField("sourceUrl", e.target.value)}
                    className={inputClass}
                    placeholder="https://supplier.com/product/123"
                  />
                </FormField>
                <FormField label="Lead Time (days)">
                  <input
                    type="number"
                    value={String(product.leadTime ?? "")}
                    onChange={(e) => updateField("leadTime", e.target.value)}
                    className={inputClass}
                    placeholder="7"
                  />
                </FormField>
                <FormField label="Min Order Quantity">
                  <input
                    type="number"
                    value={String(product.moq ?? "")}
                    onChange={(e) => updateField("moq", e.target.value)}
                    className={inputClass}
                    placeholder="10"
                  />
                </FormField>
              </>
            )}

            {activeTab === "cost" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Cost Price">
                    <input
                      type="number"
                      value={String(product.costPrice ?? "")}
                      onChange={(e) => updateField("costPrice", e.target.value)}
                      className={inputClass}
                      placeholder="10.00"
                    />
                  </FormField>
                  <FormField label="Sell Price">
                    <input
                      type="number"
                      value={String(product.price ?? "")}
                      onChange={(e) => updateField("price", e.target.value)}
                      className={inputClass}
                      placeholder="25.00"
                    />
                  </FormField>
                  <FormField label="Shipping Cost">
                    <input
                      type="number"
                      value={String(product.shippingCost ?? "")}
                      onChange={(e) => updateField("shippingCost", e.target.value)}
                      className={inputClass}
                      placeholder="2.50"
                    />
                  </FormField>
                  <FormField label="Duty Rate (%)">
                    <input
                      type="number"
                      value={String(product.dutyRate ?? "")}
                      onChange={(e) => updateField("dutyRate", e.target.value)}
                      className={inputClass}
                      placeholder="5"
                    />
                  </FormField>
                </div>

                <div className="mt-2 p-4 rounded-xl border border-white/8 space-y-3" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  <p className="text-xs font-semibold">Landed Cost Preview</p>
                  <div className="space-y-2">
                    {[
                      { label: "Base Cost", value: costPrice },
                      { label: "Shipping", value: shippingCost },
                      { label: `Duty (${dutyRate}%)`, value: (costPrice * dutyRate) / 100 },
                      { label: "Landed Cost", value: landedCost, bold: true },
                      { label: "Sell Price", value: sellPrice, bold: true },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between text-xs">
                        <span className={row.bold ? "font-semibold" : "text-muted-foreground"}>{row.label}</span>
                        <span className={row.bold ? "font-semibold" : "text-muted-foreground"}>
                          ${row.value.toFixed(2)}
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-white/10 pt-2 flex items-center justify-between">
                      <span className="text-xs font-semibold">Margin</span>
                      <span className={`text-sm font-bold ${marginColor}`}>
                        {sellPrice > 0 ? `${margin.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === "listing" && (
              <div className="space-y-3">
                <div className="p-4 rounded-2xl border border-white/10 bg-white/3 space-y-3" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <Package className="w-6 h-6 text-white/30" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{String(product.name ?? "Product Name")}</p>
                      <p className="text-xs text-muted-foreground">{String(product.category ?? "Uncategorized")}</p>
                    </div>
                  </div>
                  {product.description ? (
                    <p className="text-xs text-muted-foreground">{String(product.description)}</p>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "Price", value: product.price ? `$${parseFloat(String(product.price)).toFixed(2)}` : "—" },
                      { label: "Fulfillment", value: String(product.fulfillmentModel ?? "—") },
                      { label: "Variants", value: variants.length > 0 ? String(variants.length) : "None" },
                    ].map((item) => (
                      <div key={item.label} className="p-2 rounded-xl bg-white/3" style={{ background: "rgba(255,255,255,0.03)" }}>
                        <p className="text-[10px] text-muted-foreground">{item.label}</p>
                        <p className="text-xs font-semibold mt-0.5">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {[
                      { label: "Price set", ok: !!product.price },
                      { label: "Cost set", ok: !!product.costPrice },
                      { label: "Source linked", ok: !!product.supplierName || !!product.sourceUrl },
                      { label: "Variants", ok: variants.length > 0 },
                    ].map((ind) => (
                      <span
                        key={ind.label}
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          ind.ok
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : "bg-white/5 text-muted-foreground/50 border-white/10"
                        }`}
                      >
                        {ind.label}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground text-center">
                  This preview shows how the product will appear in your catalog.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-medium transition-colors disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {product.id ? "Update Product" : "Create Product"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
