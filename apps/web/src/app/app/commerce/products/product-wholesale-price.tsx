"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Tag } from "lucide-react";
import { fetchProductTierPrices, upsertProductTierPrice, type Product } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { formatCurrency } from "@/lib/currency";

/**
 * Wholesale (distributor) price editor for a product. Retail price stays on the
 * product; this sets the WHOLESALE tier override that contacts on the WHOLESALE
 * pricing tier are quoted/invoiced at. Empty = falls back to retail.
 */
export function ProductWholesalePrice({ product }: { product: Product }) {
  const [value, setValue] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const businessId = getStoredBusinessId() ?? undefined;
  const currency = (product as { currency?: string }).currency || "TTD";
  const retail = Number(product.price ?? 0);

  useEffect(() => {
    let active = true;
    void fetchProductTierPrices(product.id, businessId).then((res) => {
      if (!active) return;
      const wholesale = (res.data ?? []).find((t) => t.tier === "WHOLESALE");
      if (wholesale) setValue(String(wholesale.price));
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [product.id, businessId]);

  const save = async () => {
    const price = parseFloat(value);
    if (Number.isNaN(price) || price < 0) {
      toast.error("Enter a valid wholesale price");
      return;
    }
    setSaving(true);
    const { error } = await upsertProductTierPrice(product.id, "WHOLESALE", price, businessId);
    setSaving(false);
    if (error) {
      toast.error("Failed to save wholesale price");
      return;
    }
    toast.success("Wholesale price saved");
  };

  return (
    <div className="rounded-xl border border-border/30 bg-white/[0.02] p-3 space-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-1">
        <Tag className="w-3 h-3" /> Wholesale price
      </span>
      <p className="text-[10px] text-muted-foreground/70">
        Retail is {formatCurrency(retail, currency)}. Distributors (WHOLESALE tier) are quoted this price; empty uses retail.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={0.01}
          value={value}
          disabled={!loaded || saving}
          onChange={(e) => setValue(e.target.value)}
          placeholder={loaded ? "Not set (uses retail)" : "Loading..."}
          className="flex-1 rounded-lg border border-border/30 bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-[hsl(var(--kf-accent1))]/40"
        />
        <button
          onClick={() => void save()}
          disabled={!loaded || saving}
          className="px-3 py-1 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/30 border border-[hsl(var(--kf-accent1))]/20 transition-all disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
