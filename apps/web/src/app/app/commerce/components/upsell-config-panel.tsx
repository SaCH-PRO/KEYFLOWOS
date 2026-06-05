"use client";

import { useState, useEffect } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import { toast } from "sonner";
import { ArrowUpCircle, CheckCircle2, Loader2 } from "lucide-react";

interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
}

interface Props {
  businessId: string;
  productId: string;
}

export function UpsellConfigPanel({ businessId, productId }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId || !productId) return;
    Promise.all([
      apiGet<{ products: Product[] }>(`/catalog/businesses/${businessId}/products`),
      apiGet<{ upsells: Product[] }>(`/conversion/businesses/${businessId}/products/${productId}/upsells`),
    ]).then(([allRes, upsellRes]) => {
      if (allRes.data) {
        setProducts(((allRes.data as unknown) as { products?: Product[] }).products ?? (Array.isArray(allRes.data) ? allRes.data : []));
      }
      if (upsellRes.data) {
        setSelectedIds((((upsellRes.data as unknown) as { upsells?: Product[] }).upsells ?? (Array.isArray(upsellRes.data) ? upsellRes.data : [])).map((p: Product) => p.id));
      }
    }).catch(() => toast.error("Failed to load products"))
      .finally(() => setLoading(false));
  }, [businessId, productId]);

  const toggleProduct = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiPatch(`/conversion/businesses/${businessId}/products/${productId}/upsells`, {
        upsellIds: selectedIds,
      });
      toast.success("Upsells saved");
    } catch {
      toast.error("Failed to save upsells");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const otherProducts = products.filter((p) => p.id !== productId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowUpCircle className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Upsell Products</h3>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="kf-btn-primary px-3 py-1.5 text-xs rounded-lg disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Select products to recommend when customers view or purchase this item.
      </p>
      <div className="space-y-1.5 max-h-64 overflow-y-auto">
        {otherProducts.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No other products available.</p>
        ) : (
          otherProducts.map((p) => {
            const selected = selectedIds.includes(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggleProduct(p.id)}
                className={`w-full text-left flex items-center justify-between p-2.5 rounded-lg border transition-all text-sm ${
                  selected
                    ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/5"
                    : "border-border/30 hover:border-border/60"
                }`}
              >
                <span className="truncate">{p.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">
                    {p.currency} {p.price}
                  </span>
                  {selected ? (
                    <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-muted-foreground/30" />
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
