"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Tag } from "lucide-react";
import { updateContactPricingTier } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { PRICING_TIERS, getPricingTierLabel } from "@/lib/crm-constants";

/**
 * Inline pricing-tier control for a contact. Marking a contact WHOLESALE means
 * their quotes and invoices are priced at each product's wholesale tier price
 * automatically (falling back to retail where no wholesale price is set).
 */
export function ContactPricingTier({
  contactId,
  initialTier,
  onChanged,
}: {
  contactId: string;
  initialTier?: string | null;
  onChanged?: () => void;
}) {
  const [tier, setTier] = useState<string>(initialTier || "RETAIL");
  const [saving, setSaving] = useState(false);

  const save = async (next: string) => {
    const prev = tier;
    setTier(next);
    setSaving(true);
    const businessId = getStoredBusinessId() ?? undefined;
    const { error } = await updateContactPricingTier(contactId, next, businessId);
    setSaving(false);
    if (error) {
      setTier(prev);
      toast.error("Failed to update pricing tier");
      return;
    }
    toast.success(`Pricing tier set to ${getPricingTierLabel(next)}`);
    onChanged?.();
  };

  return (
    <div className="text-xs leading-snug">
      <span className="text-muted-foreground text-[10px] mb-0.5 flex items-center gap-1">
        <Tag className="w-3 h-3" /> Pricing tier
      </span>
      <select
        value={tier}
        disabled={saving}
        onChange={(e) => void save(e.target.value)}
        className="w-full bg-muted/40 border border-border/60 rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
        aria-label="Pricing tier"
      >
        {PRICING_TIERS.map((t) => (
          <option key={t} value={t}>{getPricingTierLabel(t)}</option>
        ))}
      </select>
      {tier !== "RETAIL" && (
        <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
          Quotes &amp; invoices use this customer&rsquo;s {getPricingTierLabel(tier).toLowerCase()} pricing.
        </span>
      )}
    </div>
  );
}
