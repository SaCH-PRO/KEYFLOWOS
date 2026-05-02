"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Tag,
  Plus,
  Copy,
  CheckCircle2,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  X,
  Calendar,
  Percent,
  DollarSign,
  Truck,
} from "lucide-react";

type DiscountType = "percentage" | "fixed" | "free_shipping";

interface PromoCode {
  id: string;
  code: string;
  discountType: DiscountType;
  value: number;
  minimumOrder: number;
  maxUses: number;
  currentUses: number;
  validFrom: string;
  validTo: string;
  active: boolean;
  revenueGenerated: number;
  totalDiscountGiven: number;
}

const DEMO_PROMOS: PromoCode[] = [
  { id: "pr1", code: "WELCOME10", discountType: "percentage", value: 10, minimumOrder: 50, maxUses: 100, currentUses: 34, validFrom: "2026-01-01", validTo: "2026-12-31", active: true, revenueGenerated: 2450.00, totalDiscountGiven: 245.00 },
  { id: "pr2", code: "SPRING25", discountType: "percentage", value: 25, minimumOrder: 100, maxUses: 50, currentUses: 18, validFrom: "2026-03-01", validTo: "2026-05-31", active: true, revenueGenerated: 3200.00, totalDiscountGiven: 800.00 },
  { id: "pr3", code: "FLAT20", discountType: "fixed", value: 20, minimumOrder: 75, maxUses: 200, currentUses: 45, validFrom: "2026-01-15", validTo: "2026-06-30", active: true, revenueGenerated: 4500.00, totalDiscountGiven: 900.00 },
  { id: "pr4", code: "FREESHIP", discountType: "free_shipping", value: 0, minimumOrder: 40, maxUses: 500, currentUses: 112, validFrom: "2026-01-01", validTo: "2026-12-31", active: true, revenueGenerated: 8900.00, totalDiscountGiven: 560.00 },
  { id: "pr5", code: "VIP50", discountType: "percentage", value: 50, minimumOrder: 200, maxUses: 10, currentUses: 10, validFrom: "2026-02-01", validTo: "2026-03-31", active: false, revenueGenerated: 1800.00, totalDiscountGiven: 900.00 },
];

const DISCOUNT_ICONS: Record<DiscountType, React.ElementType> = {
  percentage: Percent,
  fixed: DollarSign,
  free_shipping: Truck,
};

const DISCOUNT_LABELS: Record<DiscountType, string> = {
  percentage: "Percentage",
  fixed: "Fixed Amount",
  free_shipping: "Free Shipping",
};

function formatDiscount(type: DiscountType, value: number): string {
  if (type === "percentage") return `${value}% off`;
  if (type === "fixed") return `$${value.toFixed(2)} off`;
  return "Free Shipping";
}

interface PromoFormState {
  code: string;
  discountType: DiscountType;
  value: number;
  minimumOrder: number;
  maxUses: number;
  validFrom: string;
  validTo: string;
}

const EMPTY_FORM: PromoFormState = {
  code: "", discountType: "percentage", value: 10, minimumOrder: 0, maxUses: 100,
  validFrom: new Date().toISOString().split("T")[0],
  validTo: new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0],
};

function PromoFormModal({ initial, onSave, onClose }: { initial?: PromoFormState; onSave: (data: PromoFormState) => void; onClose: () => void }) {
  const [form, setForm] = useState<PromoFormState>(initial ?? EMPTY_FORM);
  const update = (partial: Partial<PromoFormState>) => setForm((p) => ({ ...p, ...partial }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="promo-form-title" style={{ background: "hsl(var(--kf-background)/0.7)" }} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="rounded-2xl p-5 w-full max-w-md space-y-4"
        style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border))" }}
      >
        <div className="flex items-center justify-between">
          <h3 id="promo-form-title" className="text-sm font-semibold">{initial ? "Edit Promo Code" : "Create Promo Code"}</h3>
          <button onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] flex items-center justify-center text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="promo-code" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">Code</label>
            <input id="promo-code" value={form.code} onChange={(e) => update({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} placeholder="e.g. SAVE20" className="w-full px-3 py-2.5 rounded-xl text-xs min-h-[44px]" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.5)" }} />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">Discount Type</label>
            <div className="flex gap-1.5">
              {(["percentage", "fixed", "free_shipping"] as const).map((t) => {
                const Icon = DISCOUNT_ICONS[t];
                return (
                  <button key={t} onClick={() => update({ discountType: t })} className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-xl text-[11px] font-medium min-h-[40px] transition-colors" style={{ background: form.discountType === t ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted)/0.08)", color: form.discountType === t ? "hsl(var(--kf-accent1-foreground, 0 0% 100%))" : "inherit", border: `1px solid ${form.discountType === t ? "transparent" : "hsl(var(--kf-border)/0.3)"}` }}>
                    <Icon className="w-3 h-3" />{DISCOUNT_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {form.discountType !== "free_shipping" && (
            <div>
              <label htmlFor="promo-value" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">{form.discountType === "percentage" ? "Discount %" : "Amount ($)"}</label>
              <input id="promo-value" type="number" value={form.value} onChange={(e) => update({ value: Number(e.target.value) })} className="w-full px-3 py-2.5 rounded-xl text-xs min-h-[44px]" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.5)" }} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="promo-min-order" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">Min Order ($)</label>
              <input id="promo-min-order" type="number" value={form.minimumOrder} onChange={(e) => update({ minimumOrder: Number(e.target.value) })} className="w-full px-3 py-2.5 rounded-xl text-xs min-h-[44px]" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.5)" }} />
            </div>
            <div>
              <label htmlFor="promo-max-uses" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">Max Uses</label>
              <input id="promo-max-uses" type="number" value={form.maxUses} onChange={(e) => update({ maxUses: Number(e.target.value) })} className="w-full px-3 py-2.5 rounded-xl text-xs min-h-[44px]" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.5)" }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="promo-valid-from" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">Valid From</label>
              <input id="promo-valid-from" type="date" value={form.validFrom} onChange={(e) => update({ validFrom: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-xs min-h-[44px]" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.5)" }} />
            </div>
            <div>
              <label htmlFor="promo-valid-to" className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">Valid To</label>
              <input id="promo-valid-to" type="date" value={form.validTo} onChange={(e) => update({ validTo: e.target.value })} className="w-full px-3 py-2.5 rounded-xl text-xs min-h-[44px]" style={{ background: "hsl(var(--kf-muted)/0.08)", border: "1px solid hsl(var(--kf-border)/0.5)" }} />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg border min-h-[44px] transition-colors" style={{ borderColor: "hsl(var(--kf-border)/0.6)" }}>Cancel</button>
          <button onClick={() => { if (form.code.trim()) onSave(form); }} disabled={!form.code.trim()} className="flex-1 text-sm font-medium px-4 py-2.5 rounded-lg min-h-[44px] transition-colors disabled:opacity-40" style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}>
            {initial ? "Save Changes" : "Create Code"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function PromosPanel() {
  const [promos, setPromos] = useState<PromoCode[]>(DEMO_PROMOS);
  const [showForm, setShowForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState<PromoCode | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = useCallback((code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleToggle = useCallback((id: string) => {
    setPromos((prev) => prev.map((p) => p.id === id ? { ...p, active: !p.active } : p));
  }, []);

  const handleDelete = useCallback((id: string) => {
    setPromos((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleSave = useCallback((data: PromoFormState) => {
    if (editingPromo) {
      setPromos((prev) => prev.map((p) => p.id === editingPromo.id ? { ...p, ...data } : p));
    } else {
      const newPromo: PromoCode = {
        id: `pr_${Date.now()}`, ...data, currentUses: 0, active: true, revenueGenerated: 0, totalDiscountGiven: 0,
      };
      setPromos((prev) => [newPromo, ...prev]);
    }
    setShowForm(false);
    setEditingPromo(null);
  }, [editingPromo]);

  const activeCount = promos.filter((p) => p.active).length;
  const totalRevenue = promos.reduce((s, p) => s + p.revenueGenerated, 0);
  const totalDiscount = promos.reduce((s, p) => s + p.totalDiscountGiven, 0);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl p-3.5" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
          <p className="text-[10px] text-muted-foreground mb-1">Active Codes</p>
          <p className="text-lg font-bold">{activeCount}</p>
        </div>
        <div className="rounded-xl p-3.5" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
          <p className="text-[10px] text-muted-foreground mb-1">Revenue Generated</p>
          <p className="text-lg font-bold">${totalRevenue.toLocaleString()}</p>
        </div>
        <div className="rounded-xl p-3.5" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
          <p className="text-[10px] text-muted-foreground mb-1">Total Discounts</p>
          <p className="text-lg font-bold">${totalDiscount.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => { setEditingPromo(null); setShowForm(true); }}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium min-h-[44px] transition-colors"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
        >
          <Plus className="w-3.5 h-3.5" />New Promo Code
        </button>
      </div>

      <div className="space-y-2">
        {promos.length === 0 ? (
          <div className="rounded-xl p-8 text-center" style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)" }}>
            <Tag className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No promo codes yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create your first promo code to boost sales</p>
          </div>
        ) : (
          promos.map((promo, idx) => {
            const Icon = DISCOUNT_ICONS[promo.discountType];
            const usagePercent = promo.maxUses > 0 ? Math.round((promo.currentUses / promo.maxUses) * 100) : 0;
            const isExpired = new Date(promo.validTo) < new Date();

            return (
              <motion.div
                key={promo.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="rounded-xl p-4"
                style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--kf-border)/0.5)", opacity: promo.active ? 1 : 0.6 }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--kf-accent1)/0.08)" }}>
                    <Icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold font-mono tracking-wider">{promo.code}</span>
                      <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold" style={{ background: promo.active && !isExpired ? "hsl(var(--kf-success)/0.1)" : "hsl(var(--kf-neutral)/0.1)", color: promo.active && !isExpired ? "hsl(var(--kf-success))" : "hsl(var(--kf-neutral))" }}>
                        {isExpired ? "Expired" : promo.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDiscount(promo.discountType, promo.value)} · Min ${promo.minimumOrder}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                      <span>{promo.currentUses}/{promo.maxUses} uses ({usagePercent}%)</span>
                      <span>·</span>
                      <span className="flex items-center gap-0.5"><Calendar className="w-2.5 h-2.5" />{new Date(promo.validFrom).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(promo.validTo).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                      <span style={{ color: "hsl(var(--kf-success))" }}>Revenue: ${promo.revenueGenerated.toLocaleString()}</span>
                      <span className="text-muted-foreground">Discounts: ${promo.totalDiscountGiven.toLocaleString()}</span>
                    </div>

                    <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted)/0.15)" }}>
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(usagePercent, 100)}%`, background: usagePercent >= 90 ? "hsl(var(--kf-error))" : usagePercent >= 70 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-accent1))" }} />
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => handleCopy(promo.code, promo.id)} className="p-2 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)]" title="Copy code">
                      {copiedId === promo.id ? <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                    <button onClick={() => { setEditingPromo(promo); setShowForm(true); }} className="p-2 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)]" title="Edit">
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button onClick={() => handleToggle(promo.id)} className="p-2 rounded-lg transition-colors hover:bg-[hsl(var(--kf-muted)/0.1)]" title={promo.active ? "Deactivate" : "Activate"}>
                      {promo.active ? <ToggleRight className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} /> : <ToggleLeft className="w-4 h-4 text-muted-foreground" />}
                    </button>
                    <button onClick={() => handleDelete(promo.id)} className="p-2 rounded-lg transition-colors hover:bg-[hsl(var(--kf-error)/0.05)]" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-error)/0.6)" }} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {showForm && (
        <PromoFormModal
          initial={editingPromo ? { code: editingPromo.code, discountType: editingPromo.discountType, value: editingPromo.value, minimumOrder: editingPromo.minimumOrder, maxUses: editingPromo.maxUses, validFrom: editingPromo.validFrom, validTo: editingPromo.validTo } : undefined}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingPromo(null); }}
        />
      )}
    </motion.div>
  );
}
